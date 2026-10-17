/**
 * AgentProof MCP Layer — Trace Registry & Repository Bridge
 * 
 * Provides thread-safe storage and lifecycle management for immutable VerificationTraces.
 * Bridges legacy ITraceRegistry and Phase 5 ITraceRepository.
 */

import { VerificationTrace } from '../../core/index.js';
import { ITraceRepository, TraceListOptions } from '../../persistence/index.js';
import { DuplicateTraceError } from '../../security/errors.js';

export interface ITraceRegistry {
  /**
   * Stores a VerificationTrace in the registry.
   */
  save(trace: VerificationTrace): void | Promise<void>;

  /**
   * Retrieves a VerificationTrace by trace ID.
   * If tenantId is specified, enforces tenant isolation.
   * Returns null if trace does not exist or tenant mismatch occurs.
   */
  getById(traceId: string, tenantId?: string): VerificationTrace | null | Promise<VerificationTrace | null>;

  /**
   * Checks if a trace exists.
   */
  has(traceId: string): boolean | Promise<boolean>;

  /**
   * Clears all traces (useful for test isolation).
   */
  clear(): void | Promise<void>;

  /**
   * Returns current count of stored traces.
   */
  count(): number | Promise<number>;
}

export class InMemoryTraceRegistry implements ITraceRegistry, ITraceRepository {
  private readonly storage: Map<string, VerificationTrace> = new Map();

  public save(trace: VerificationTrace, tenantId?: string): void {
    if (!trace || !trace.traceId) {
      throw new Error('Cannot store trace: traceId is required.');
    }
    if (this.storage.has(trace.traceId)) {
      throw new DuplicateTraceError(
        `Trace with ID [${trace.traceId}] already exists. Verification traces are immutable audit records and cannot be overwritten.`
      );
    }

    if (tenantId) {
      const traceTenantId = trace.request.target.tenantId;
      if (traceTenantId && traceTenantId !== tenantId) {
        throw new Error(
          `Tenant scope mismatch: cannot save trace for [${tenantId}] when trace target is [${traceTenantId}].`
        );
      }
    }

    // Store deep clone to guarantee immutability
    this.storage.set(trace.traceId, JSON.parse(JSON.stringify(trace)));
  }

  public async saveForTenant(tenantId: string, trace: VerificationTrace): Promise<void> {
    this.save(trace, tenantId);
  }

  public getById(traceId: string, tenantId?: string): VerificationTrace | null {
    const trace = this.storage.get(traceId);
    if (!trace) {
      return null;
    }

    // Enforce tenant isolation if tenant context is specified
    if (tenantId && tenantId !== '*') {
      const traceTenantId = trace.request.target.tenantId;
      if (traceTenantId && traceTenantId !== tenantId) {
        return null; // Tenant mismatch: deny access
      }
    }

    return JSON.parse(JSON.stringify(trace));
  }

  public async getByTenantAndId(tenantId: string, traceId: string): Promise<VerificationTrace | null> {
    return this.getById(traceId, tenantId);
  }

  public async listByTenant(
    tenantId: string,
    options?: TraceListOptions
  ): Promise<readonly VerificationTrace[]> {
    const list: VerificationTrace[] = [];
    for (const trace of this.storage.values()) {
      const traceTenant = trace.request.target.tenantId ?? 'default';
      if (tenantId === '*' || traceTenant === tenantId) {
        if (options?.verdict && trace.result.overallVerdict !== options.verdict) {
          continue;
        }
        list.push(JSON.parse(JSON.stringify(trace)));
      }
    }

    const offset = options?.offset ?? 0;
    const limit = options?.limit ?? 50;
    return Object.freeze(list.slice(offset, offset + limit));
  }

  public has(traceId: string, tenantId?: string): boolean {
    if (!this.storage.has(traceId)) return false;
    if (!tenantId || tenantId === '*') return true;
    const trace = this.storage.get(traceId);
    return trace?.request.target.tenantId === tenantId;
  }

  public clear(): void {
    this.storage.clear();
  }

  public count(tenantId?: string): number {
    if (!tenantId) return this.storage.size;
    let cnt = 0;
    for (const trace of this.storage.values()) {
      if (trace.request.target.tenantId === tenantId) cnt++;
    }
    return cnt;
  }

  public close(): void {
    // In-memory registry requires no special cleanup
  }
}

// Global default singleton for the application instance
export const defaultTraceRegistry = new InMemoryTraceRegistry();
