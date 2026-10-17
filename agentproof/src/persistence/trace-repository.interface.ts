/**
 * AgentProof Persistence — Trace Repository Interface
 * 
 * Defines the contract for durable and in-memory verification trace storage.
 * Enforces explicit tenant-scoped access, write-once immutability, and deterministic retrieval.
 */

import { VerificationTrace, VerificationVerdict } from '../core/index.js';

export interface TraceListOptions {
  readonly limit?: number;
  readonly offset?: number;
  readonly verdict?: VerificationVerdict;
}

export interface ITraceRepository {
  /**
   * Stores a VerificationTrace in the repository.
   * If tenantId is not provided, extracts it from trace.request.target.tenantId.
   * Enforces write-once immutability: throws DuplicateTraceError if traceId already exists.
   */
  save(trace: VerificationTrace, tenantId?: string): Promise<void> | void;

  /**
   * Explicitly scopes a trace write to an authorized tenant.
   */
  saveForTenant(tenantId: string, trace: VerificationTrace): Promise<void>;

  /**
   * Retrieves a trace strictly scoped to the specified tenant.
   * Returns null if the trace does not exist or does not belong to the tenant.
   */
  getByTenantAndId(tenantId: string, traceId: string): Promise<VerificationTrace | null>;

  /**
   * Retrieves a trace by traceId, with optional tenant filtering.
   * Retained for backward compatibility with ITraceRegistry.
   */
  getById(traceId: string, tenantId?: string): Promise<VerificationTrace | null> | VerificationTrace | null;

  /**
   * Lists traces belonging to a specific tenant.
   */
  listByTenant(tenantId: string, options?: TraceListOptions): Promise<readonly VerificationTrace[]>;

  /**
   * Checks whether a trace exists in the repository.
   */
  has(traceId: string, tenantId?: string): Promise<boolean> | boolean;

  /**
   * Returns count of traces, optionally filtered by tenant.
   */
  count(tenantId?: string): Promise<number> | number;

  /**
   * Clears repository contents (primarily for testing).
   */
  clear(): Promise<void> | void;

  /**
   * Closes the repository and releases any file handles or locks.
   */
  close(): Promise<void> | void;
}
