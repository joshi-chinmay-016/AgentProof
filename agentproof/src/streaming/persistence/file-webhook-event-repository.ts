/**
 * AgentProof Streaming & Webhooks — File-backed Durable Webhook Event Repository
 * 
 * Provides disk-backed persistence with atomic file writes, crash recovery,
 * tenant isolation, and strict state transition validation.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
  IWebhookEventRepository,
  WebhookEventQueryOptions,
  WebhookStatusUpdateOptions,
} from './webhook-event-repository.interface.js';
import {
  WebhookEventRecord,
  WebhookEventStatus,
} from '../contracts/webhook.interface.js';

export class InvalidStateTransitionError extends Error {
  constructor(
    public readonly eventId: string,
    public readonly currentStatus: WebhookEventStatus,
    public readonly targetStatus: WebhookEventStatus
  ) {
    super(
      `Invalid state transition for webhook event ${eventId}: cannot move from ${currentStatus} to ${targetStatus}`
    );
    this.name = 'InvalidStateTransitionError';
  }
}

const VALID_TRANSITIONS: Record<WebhookEventStatus, readonly WebhookEventStatus[]> = {
  RECEIVED: ['VERIFIED', 'QUARANTINED'],
  VERIFIED: ['QUEUED', 'QUARANTINED'],
  QUEUED: ['PROCESSING', 'QUARANTINED'],
  PROCESSING: ['COMPLETED', 'RETRYABLE_FAILURE', 'PERMANENT_FAILURE', 'QUARANTINED'],
  RETRYABLE_FAILURE: ['QUEUED', 'PROCESSING', 'PERMANENT_FAILURE', 'QUARANTINED'],
  COMPLETED: [],
  PERMANENT_FAILURE: [],
  QUARANTINED: [],
};

export class FileWebhookEventRepository implements IWebhookEventRepository {
  private readonly baseDir: string;
  private memoryCache: Map<string, WebhookEventRecord> = new Map();
  private initialized = false;

  constructor(baseDir: string = path.join(process.cwd(), '.agentproof', 'data', 'webhook-events')) {
    this.baseDir = path.resolve(baseDir);
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    await fs.mkdir(this.baseDir, { recursive: true });
    this.initialized = true;
  }

  private getEventFilePath(tenantId: string, sourceId: string, internalEventId: string): string {
    const safeTenant = tenantId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeSource = sourceId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeEventId = internalEventId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.baseDir, safeTenant, safeSource, `${safeEventId}.json`);
  }

  private getTenantDir(tenantId: string): string {
    const safeTenant = tenantId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.baseDir, safeTenant);
  }

  private async writeAtomic(filePath: string, data: WebhookEventRecord): Promise<void> {
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });

    const tempPath = `${filePath}.${Date.now()}.${Math.random().toString(36).substring(2, 9)}.tmp`;
    const serialized = JSON.stringify(data, null, 2);

    await fs.writeFile(tempPath, serialized, 'utf-8');
    await fs.rename(tempPath, filePath);

    // Update memory cache
    const cacheKey = `${data.tenantId}:${data.internalEventId}`;
    this.memoryCache.set(cacheKey, data);
  }

  async create(event: WebhookEventRecord): Promise<void> {
    await this.ensureInitialized();
    const filePath = this.getEventFilePath(event.tenantId, event.sourceId, event.internalEventId);

    try {
      await fs.access(filePath);
      throw new Error(`Webhook event with ID ${event.internalEventId} already exists for tenant ${event.tenantId}`);
    } catch (err: any) {
      if (err.code !== 'ENOENT') {
        throw err;
      }
    }

    await this.writeAtomic(filePath, event);
  }

  async getById(tenantId: string, internalEventId: string): Promise<WebhookEventRecord | null> {
    await this.ensureInitialized();
    const cacheKey = `${tenantId}:${internalEventId}`;
    if (this.memoryCache.has(cacheKey)) {
      return this.memoryCache.get(cacheKey)!;
    }

    const tenantDir = this.getTenantDir(tenantId);
    try {
      const sourceDirs = await fs.readdir(tenantDir, { withFileTypes: true });
      for (const sDir of sourceDirs) {
        if (!sDir.isDirectory()) continue;
        const filePath = path.join(tenantDir, sDir.name, `${internalEventId}.json`);
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          const record = JSON.parse(content) as WebhookEventRecord;
          this.memoryCache.set(cacheKey, record);
          return record;
        } catch (readErr: any) {
          if (readErr.code !== 'ENOENT') throw readErr;
        }
      }
    } catch (err: any) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }

    return null;
  }

  async getByExternalId(
    tenantId: string,
    sourceId: string,
    externalEventId: string
  ): Promise<WebhookEventRecord | null> {
    await this.ensureInitialized();
    const allTenantEvents = await this.query({ tenantId, sourceId });
    const match = allTenantEvents.find((e) => e.externalEventId === externalEventId);
    return match || null;
  }

  async query(options: WebhookEventQueryOptions): Promise<WebhookEventRecord[]> {
    await this.ensureInitialized();
    const tenantDir = this.getTenantDir(options.tenantId);
    const results: WebhookEventRecord[] = [];

    try {
      const sourceDirs = await fs.readdir(tenantDir, { withFileTypes: true });
      for (const sDir of sourceDirs) {
        if (!sDir.isDirectory()) continue;
        if (options.sourceId && sDir.name !== options.sourceId.replace(/[^a-zA-Z0-9_-]/g, '_')) {
          continue;
        }

        const sourcePath = path.join(tenantDir, sDir.name);
        const files = await fs.readdir(sourcePath);
        for (const file of files) {
          if (!file.endsWith('.json')) continue;
          const filePath = path.join(sourcePath, file);
          const content = await fs.readFile(filePath, 'utf-8');
          const record = JSON.parse(content) as WebhookEventRecord;

          if (options.status) {
            const statuses = Array.isArray(options.status) ? options.status : [options.status];
            if (!statuses.includes(record.status)) continue;
          }

          results.push(record);
          if (options.limit && results.length >= options.limit) {
            return results;
          }
        }
      }
    } catch (err: any) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }

    return results;
  }

  async getPendingEvents(tenantId?: string, limit?: number): Promise<WebhookEventRecord[]> {
    await this.ensureInitialized();
    const pendingStatuses: WebhookEventStatus[] = ['QUEUED', 'RETRYABLE_FAILURE'];

    if (tenantId) {
      return this.query({
        tenantId,
        status: pendingStatuses,
        limit,
      });
    }

    // Scan all tenant directories
    const results: WebhookEventRecord[] = [];
    try {
      const tenants = await fs.readdir(this.baseDir, { withFileTypes: true });
      for (const t of tenants) {
        if (!t.isDirectory()) continue;
        const tenantEvents = await this.query({
          tenantId: t.name,
          status: pendingStatuses,
        });
        results.push(...tenantEvents);
        if (limit && results.length >= limit) {
          return results.slice(0, limit);
        }
      }
    } catch (err: any) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }

    return results;
  }

  async updateStatus(
    tenantId: string,
    internalEventId: string,
    nextStatus: WebhookEventStatus,
    updates: WebhookStatusUpdateOptions = {}
  ): Promise<WebhookEventRecord> {
    const existing = await this.getById(tenantId, internalEventId);
    if (!existing) {
      throw new Error(`Webhook event ${internalEventId} not found for tenant ${tenantId}`);
    }

    const allowed = VALID_TRANSITIONS[existing.status];
    if (!allowed || !allowed.includes(nextStatus)) {
      throw new InvalidStateTransitionError(internalEventId, existing.status, nextStatus);
    }

    const updatedRecord: WebhookEventRecord = {
      ...existing,
      status: nextStatus,
      attempts: updates.incrementAttempts ? existing.attempts + 1 : existing.attempts,
      lastError: updates.lastError !== undefined ? updates.lastError : existing.lastError,
      errorCategory: updates.errorCategory !== undefined ? updates.errorCategory : existing.errorCategory,
      correlationId: updates.correlationId !== undefined ? updates.correlationId : existing.correlationId,
      traceId: updates.traceId !== undefined ? updates.traceId : existing.traceId,
      completedAt: updates.completedAt !== undefined ? updates.completedAt : existing.completedAt,
    };

    const filePath = this.getEventFilePath(tenantId, existing.sourceId, internalEventId);
    await this.writeAtomic(filePath, updatedRecord);
    return updatedRecord;
  }

  async recoverInFlightEvents(tenantId?: string): Promise<number> {
    await this.ensureInitialized();
    let recovered = 0;

    const findAndRecoverInTenant = async (tId: string) => {
      const processingEvents = await this.query({
        tenantId: tId,
        status: 'PROCESSING',
      });

      for (const event of processingEvents) {
        await this.updateStatus(tId, event.internalEventId, 'RETRYABLE_FAILURE', {
          lastError: 'Recovered after ungraceful shutdown or crash while in PROCESSING state',
          errorCategory: 'SYSTEM_CRASH_RECOVERY',
        });
        recovered++;
      }
    };

    if (tenantId) {
      await findAndRecoverInTenant(tenantId);
    } else {
      try {
        const tenants = await fs.readdir(this.baseDir, { withFileTypes: true });
        for (const t of tenants) {
          if (t.isDirectory()) {
            await findAndRecoverInTenant(t.name);
          }
        }
      } catch (err: any) {
        if (err.code !== 'ENOENT') throw err;
      }
    }

    return recovered;
  }
}

/**
 * In-memory repository for unit testing and simulations.
 */
export class InMemoryWebhookEventRepository implements IWebhookEventRepository {
  private events: Map<string, WebhookEventRecord> = new Map();

  private key(tenantId: string, internalEventId: string): string {
    return `${tenantId}:${internalEventId}`;
  }

  async create(event: WebhookEventRecord): Promise<void> {
    const k = this.key(event.tenantId, event.internalEventId);
    if (this.events.has(k)) {
      throw new Error(`Webhook event with ID ${event.internalEventId} already exists for tenant ${event.tenantId}`);
    }
    this.events.set(k, { ...event });
  }

  async getById(tenantId: string, internalEventId: string): Promise<WebhookEventRecord | null> {
    const record = this.events.get(this.key(tenantId, internalEventId));
    return record ? { ...record } : null;
  }

  async getByExternalId(
    tenantId: string,
    sourceId: string,
    externalEventId: string
  ): Promise<WebhookEventRecord | null> {
    for (const record of this.events.values()) {
      if (
        record.tenantId === tenantId &&
        record.sourceId === sourceId &&
        record.externalEventId === externalEventId
      ) {
        return { ...record };
      }
    }
    return null;
  }

  async query(options: WebhookEventQueryOptions): Promise<WebhookEventRecord[]> {
    const results: WebhookEventRecord[] = [];
    for (const record of this.events.values()) {
      if (record.tenantId !== options.tenantId) continue;
      if (options.sourceId && record.sourceId !== options.sourceId) continue;
      if (options.status) {
        const statuses = Array.isArray(options.status) ? options.status : [options.status];
        if (!statuses.includes(record.status)) continue;
      }
      results.push({ ...record });
      if (options.limit && results.length >= options.limit) break;
    }
    return results;
  }

  async getPendingEvents(tenantId?: string, limit?: number): Promise<WebhookEventRecord[]> {
    const pendingStatuses: WebhookEventStatus[] = ['QUEUED', 'RETRYABLE_FAILURE'];
    const results: WebhookEventRecord[] = [];
    for (const record of this.events.values()) {
      if (tenantId && record.tenantId !== tenantId) continue;
      if (pendingStatuses.includes(record.status)) {
        results.push({ ...record });
        if (limit && results.length >= limit) break;
      }
    }
    return results;
  }

  async updateStatus(
    tenantId: string,
    internalEventId: string,
    nextStatus: WebhookEventStatus,
    updates: WebhookStatusUpdateOptions = {}
  ): Promise<WebhookEventRecord> {
    const k = this.key(tenantId, internalEventId);
    const existing = this.events.get(k);
    if (!existing) {
      throw new Error(`Webhook event ${internalEventId} not found for tenant ${tenantId}`);
    }

    const allowed = VALID_TRANSITIONS[existing.status];
    if (!allowed || !allowed.includes(nextStatus)) {
      throw new InvalidStateTransitionError(internalEventId, existing.status, nextStatus);
    }

    const updatedRecord: WebhookEventRecord = {
      ...existing,
      status: nextStatus,
      attempts: updates.incrementAttempts ? existing.attempts + 1 : existing.attempts,
      lastError: updates.lastError !== undefined ? updates.lastError : existing.lastError,
      errorCategory: updates.errorCategory !== undefined ? updates.errorCategory : existing.errorCategory,
      correlationId: updates.correlationId !== undefined ? updates.correlationId : existing.correlationId,
      traceId: updates.traceId !== undefined ? updates.traceId : existing.traceId,
      completedAt: updates.completedAt !== undefined ? updates.completedAt : existing.completedAt,
    };

    this.events.set(k, updatedRecord);
    return { ...updatedRecord };
  }

  async recoverInFlightEvents(tenantId?: string): Promise<number> {
    let count = 0;
    for (const [k, record] of this.events.entries()) {
      if (tenantId && record.tenantId !== tenantId) continue;
      if (record.status === 'PROCESSING') {
        this.events.set(k, {
          ...record,
          status: 'RETRYABLE_FAILURE',
          lastError: 'Recovered after ungraceful shutdown or crash while in PROCESSING state',
          errorCategory: 'SYSTEM_CRASH_RECOVERY',
        });
        count++;
      }
    }
    return count;
  }
}
