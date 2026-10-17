/**
 * AgentProof Persistence — In-Memory Trace Repository
 * 
 * Provides thread-safe, volatile in-memory storage for deterministic tests
 * and local simulation environments.
 */

import { VerificationTrace } from '../core/index.js';
import { ITraceRepository, TraceListOptions } from './trace-repository.interface.js';
import { DuplicateTraceError } from '../security/errors.js';

export class InMemoryTraceRepository implements ITraceRepository {
  private readonly storage: Map<string, { trace: VerificationTrace; tenantId: string }> = new Map();

  public async save(trace: VerificationTrace, tenantId?: string): Promise<void> {
    this.saveSync(trace, tenantId);
  }

  public saveSync(trace: VerificationTrace, tenantId?: string): void {
    if (!trace || !trace.traceId) {
      throw new Error('Cannot store trace: traceId is required.');
    }
    if (this.storage.has(trace.traceId)) {
      throw new DuplicateTraceError(trace.traceId);
    }

    const effectiveTenantId = tenantId ?? trace.request?.target?.tenantId ?? '_global';
    // Deep clone snapshot to enforce runtime immutability
    const snapshot = JSON.parse(JSON.stringify(trace));
    this.storage.set(trace.traceId, { trace: snapshot, tenantId: effectiveTenantId });
  }

  public async saveForTenant(tenantId: string, trace: VerificationTrace): Promise<void> {
    return this.save(trace, tenantId);
  }

  public async getByTenantAndId(tenantId: string, traceId: string): Promise<VerificationTrace | null> {
    const entry = this.storage.get(traceId);
    if (!entry) {
      return null;
    }
    if (entry.tenantId !== tenantId) {
      return null; // Tenant mismatch: strictly deny access
    }
    return JSON.parse(JSON.stringify(entry.trace));
  }

  public async getById(traceId: string, tenantId?: string): Promise<VerificationTrace | null> {
    return this.getByIdSync(traceId, tenantId);
  }

  public getByIdSync(traceId: string, tenantId?: string): VerificationTrace | null {
    const entry = this.storage.get(traceId);
    if (!entry) {
      return null;
    }

    if (tenantId && entry.tenantId !== tenantId && entry.tenantId !== '_global') {
      return null;
    }

    return JSON.parse(JSON.stringify(entry.trace));
  }

  public async listByTenant(tenantId: string, options?: TraceListOptions): Promise<readonly VerificationTrace[]> {
    const matches: VerificationTrace[] = [];

    for (const entry of this.storage.values()) {
      if (entry.tenantId === tenantId) {
        if (!options?.verdict || entry.trace.result?.overallVerdict === options.verdict) {
          matches.push(JSON.parse(JSON.stringify(entry.trace)));
        }
      }
    }

    // Apply offset and limit
    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? matches.length;
    return Object.freeze(matches.slice(offset, offset + limit));
  }

  public async has(traceId: string, tenantId?: string): Promise<boolean> {
    return this.hasSync(traceId, tenantId);
  }

  public hasSync(traceId: string, tenantId?: string): boolean {
    const entry = this.storage.get(traceId);
    if (!entry) return false;
    if (tenantId && entry.tenantId !== tenantId && entry.tenantId !== '_global') return false;
    return true;
  }

  public async count(tenantId?: string): Promise<number> {
    return this.countSync(tenantId);
  }

  public countSync(tenantId?: string): number {
    if (!tenantId) {
      return this.storage.size;
    }
    let n = 0;
    for (const entry of this.storage.values()) {
      if (entry.tenantId === tenantId) n++;
    }
    return n;
  }

  public async clear(): Promise<void> {
    this.clearSync();
  }

  public clearSync(): void {
    this.storage.clear();
  }

  public async close(): Promise<void> {
    // In-memory resources require no explicit handle release
  }
}
