/**
 * AgentProof MCP Layer — Trace Registry
 * 
 * Provides thread-safe, in-memory storage and lifecycle management for
 * immutable VerificationTraces.
 * 
 * NOTE: As per Phase 4 specification, this registry is in-memory and process-local.
 * Traces are not persisted across server restarts.
 */

import { VerificationTrace } from '../../core/index.js';

export interface ITraceRegistry {
  /**
   * Stores a VerificationTrace in the registry.
   */
  save(trace: VerificationTrace): void;

  /**
   * Retrieves a VerificationTrace by trace ID.
   * If tenantId is specified, enforces tenant isolation.
   * Returns null if trace does not exist or tenant mismatch occurs.
   */
  getById(traceId: string, tenantId?: string): VerificationTrace | null;

  /**
   * Checks if a trace exists.
   */
  has(traceId: string): boolean;

  /**
   * Clears all traces (useful for test isolation).
   */
  clear(): void;

  /**
   * Returns current count of stored traces.
   */
  count(): number;
}

export class InMemoryTraceRegistry implements ITraceRegistry {
  private readonly storage: Map<string, VerificationTrace> = new Map();

  public save(trace: VerificationTrace): void {
    if (!trace || !trace.traceId) {
      throw new Error('Cannot store trace: traceId is required.');
    }
    // Store deep clone to guarantee immutability
    this.storage.set(trace.traceId, JSON.parse(JSON.stringify(trace)));
  }

  public getById(traceId: string, tenantId?: string): VerificationTrace | null {
    const trace = this.storage.get(traceId);
    if (!trace) {
      return null;
    }

    // Enforce tenant isolation if tenant context is specified
    if (tenantId) {
      const traceTenantId = trace.request.target.tenantId;
      if (traceTenantId && traceTenantId !== tenantId) {
        return null; // Tenant mismatch: deny access
      }
    }

    return JSON.parse(JSON.stringify(trace));
  }

  public has(traceId: string): boolean {
    return this.storage.has(traceId);
  }

  public clear(): void {
    this.storage.clear();
  }

  public count(): number {
    return this.storage.size;
  }
}

// Global default singleton for the application instance
export const defaultTraceRegistry = new InMemoryTraceRegistry();
