/**
 * AgentProof Streaming & Webhooks — File-backed Durable Audit Event Repository
 * 
 * Implements tenant-partitioned append-only audit event persistence with
 * atomic writes, sequential locking, and hash-chain linkage.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  AuditEvent,
  GENESIS_PREVIOUS_DIGEST,
} from '../contracts/audit.interface.js';
import {
  IAuditEventRepository,
  AuditEventCreateInput,
} from './audit-repository.interface.js';
import { AuditCanonicalizer } from './audit-canonicalizer.js';

export class FileAuditEventRepository implements IAuditEventRepository {
  private readonly baseDir: string;
  private tenantLocks: Map<string, Promise<void>> = new Map();
  private memoryCache: Map<string, AuditEvent[]> = new Map();
  private initialized = false;

  constructor(baseDir: string = path.join(process.cwd(), '.agentproof', 'data', 'audit')) {
    this.baseDir = path.resolve(baseDir);
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    await fs.mkdir(this.baseDir, { recursive: true });
    this.initialized = true;
  }

  private getTenantChainPath(tenantId: string): string {
    const safeTenant = tenantId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.baseDir, safeTenant, 'chain.json');
  }

  private async acquireLock(tenantId: string): Promise<() => void> {
    while (this.tenantLocks.has(tenantId)) {
      await this.tenantLocks.get(tenantId);
    }
    let release!: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.tenantLocks.set(tenantId, lockPromise);

    return () => {
      this.tenantLocks.delete(tenantId);
      release();
    };
  }

  private async loadChain(tenantId: string): Promise<AuditEvent[]> {
    if (this.memoryCache.has(tenantId)) {
      return this.memoryCache.get(tenantId)!;
    }

    const chainPath = this.getTenantChainPath(tenantId);
    try {
      const content = await fs.readFile(chainPath, 'utf-8');
      const events = JSON.parse(content) as AuditEvent[];
      this.memoryCache.set(tenantId, events);
      return events;
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        this.memoryCache.set(tenantId, []);
        return [];
      }
      throw err;
    }
  }

  private async persistChain(tenantId: string, events: AuditEvent[]): Promise<void> {
    const chainPath = this.getTenantChainPath(tenantId);
    const dir = path.dirname(chainPath);
    await fs.mkdir(dir, { recursive: true });

    const tempPath = `${chainPath}.${Date.now()}.${Math.random().toString(36).substring(2, 9)}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(events, null, 2), 'utf-8');
    await fs.rename(tempPath, chainPath);

    this.memoryCache.set(tenantId, events);
  }

  async append(tenantId: string, input: AuditEventCreateInput): Promise<AuditEvent> {
    await this.ensureInitialized();
    const releaseLock = await this.acquireLock(tenantId);

    try {
      const chain = await this.loadChain(tenantId);

      // Check duplicate auditId
      if (chain.some((e) => e.auditId === input.auditId)) {
        throw new Error(`Audit event with ID ${input.auditId} already exists in tenant ${tenantId}`);
      }

      const lastEvent = chain.length > 0 ? chain[chain.length - 1] : null;
      const sequenceNumber = lastEvent ? lastEvent.sequenceNumber + 1 : 1;
      const previousDigest = lastEvent ? lastEvent.currentDigest : GENESIS_PREVIOUS_DIGEST;
      const payloadDigest = AuditCanonicalizer.computePayloadDigest(input.payload);
      const timestamp = input.timestamp ?? new Date().toISOString();

      const candidateEvent: Omit<AuditEvent, 'currentDigest'> = {
        schemaVersion: '1.0.0',
        auditId: input.auditId,
        tenantId,
        sequenceNumber,
        eventType: input.eventType,
        entityId: input.entityId,
        timestamp,
        payloadDigest,
        previousDigest,
        metadata: input.metadata,
      };

      const currentDigest = AuditCanonicalizer.computeEventDigest(candidateEvent);
      const fullEvent: AuditEvent = {
        ...candidateEvent,
        currentDigest,
      };

      chain.push(fullEvent);
      await this.persistChain(tenantId, chain);

      return fullEvent;
    } finally {
      releaseLock();
    }
  }

  async appendRaw(event: AuditEvent): Promise<void> {
    await this.ensureInitialized();
    const releaseLock = await this.acquireLock(event.tenantId);

    try {
      const chain = await this.loadChain(event.tenantId);
      chain.push(event);
      await this.persistChain(event.tenantId, chain);
    } finally {
      releaseLock();
    }
  }

  async getEvents(tenantId: string, fromSequence: number = 1, limit?: number): Promise<AuditEvent[]> {
    await this.ensureInitialized();
    const chain = await this.loadChain(tenantId);
    const filtered = chain.filter((e) => e.sequenceNumber >= fromSequence);
    if (limit && limit > 0) {
      return filtered.slice(0, limit);
    }
    return filtered;
  }

  async getLatestEvent(tenantId: string): Promise<AuditEvent | null> {
    await this.ensureInitialized();
    const chain = await this.loadChain(tenantId);
    return chain.length > 0 ? chain[chain.length - 1] : null;
  }

  async getById(tenantId: string, auditId: string): Promise<AuditEvent | null> {
    await this.ensureInitialized();
    const chain = await this.loadChain(tenantId);
    return chain.find((e) => e.auditId === auditId) ?? null;
  }
}

/**
 * In-memory implementation of IAuditEventRepository for fast isolated testing.
 */
export class InMemoryAuditEventRepository implements IAuditEventRepository {
  private chains: Map<string, AuditEvent[]> = new Map();

  async append(tenantId: string, input: AuditEventCreateInput): Promise<AuditEvent> {
    const chain = this.chains.get(tenantId) ?? [];
    if (chain.some((e) => e.auditId === input.auditId)) {
      throw new Error(`Audit event with ID ${input.auditId} already exists in tenant ${tenantId}`);
    }

    const lastEvent = chain.length > 0 ? chain[chain.length - 1] : null;
    const sequenceNumber = lastEvent ? lastEvent.sequenceNumber + 1 : 1;
    const previousDigest = lastEvent ? lastEvent.currentDigest : GENESIS_PREVIOUS_DIGEST;
    const payloadDigest = AuditCanonicalizer.computePayloadDigest(input.payload);
    const timestamp = input.timestamp ?? new Date().toISOString();

    const candidate: Omit<AuditEvent, 'currentDigest'> = {
      schemaVersion: '1.0.0',
      auditId: input.auditId,
      tenantId,
      sequenceNumber,
      eventType: input.eventType,
      entityId: input.entityId,
      timestamp,
      payloadDigest,
      previousDigest,
      metadata: input.metadata,
    };

    const currentDigest = AuditCanonicalizer.computeEventDigest(candidate);
    const fullEvent: AuditEvent = {
      ...candidate,
      currentDigest,
    };

    chain.push(fullEvent);
    this.chains.set(tenantId, chain);
    return fullEvent;
  }

  async appendRaw(event: AuditEvent): Promise<void> {
    const chain = this.chains.get(event.tenantId) ?? [];
    chain.push(event);
    this.chains.set(event.tenantId, chain);
  }

  async getEvents(tenantId: string, fromSequence: number = 1, limit?: number): Promise<AuditEvent[]> {
    const chain = this.chains.get(tenantId) ?? [];
    const filtered = chain.filter((e) => e.sequenceNumber >= fromSequence);
    if (limit && limit > 0) {
      return filtered.slice(0, limit);
    }
    return filtered;
  }

  async getLatestEvent(tenantId: string): Promise<AuditEvent | null> {
    const chain = this.chains.get(tenantId) ?? [];
    return chain.length > 0 ? chain[chain.length - 1] : null;
  }

  async getById(tenantId: string, auditId: string): Promise<AuditEvent | null> {
    const chain = this.chains.get(tenantId) ?? [];
    return chain.find((e) => e.auditId === auditId) ?? null;
  }
}
