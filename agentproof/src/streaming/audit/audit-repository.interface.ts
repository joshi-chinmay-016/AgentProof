/**
 * AgentProof Streaming & Webhooks — Audit Event Repository Contract
 */

import { AuditEvent } from '../contracts/audit.interface.js';

export interface AuditEventCreateInput {
  readonly auditId: string;
  readonly eventType: string;
  readonly entityId: string;
  readonly timestamp?: string;
  readonly payload: unknown;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface IAuditEventRepository {
  /**
   * Appends an audit event to the tenant's hash chain atomically.
   * Calculates the next sequence number, links to the previous digest, and computes the current digest.
   */
  append(tenantId: string, input: AuditEventCreateInput): Promise<AuditEvent>;

  /**
   * Directly appends an already computed/constructed AuditEvent (used for testing or migration).
   * Validates sequence number and digest continuity.
   */
  appendRaw(event: AuditEvent): Promise<void>;

  /**
   * Retrieves all or a slice of audit events for a tenant in sequence order.
   */
  getEvents(tenantId: string, fromSequence?: number, limit?: number): Promise<AuditEvent[]>;

  /**
   * Retrieves the latest audit event in the chain for a tenant.
   */
  getLatestEvent(tenantId: string): Promise<AuditEvent | null>;

  /**
   * Retrieves an audit event by its auditId for a tenant.
   */
  getById(tenantId: string, auditId: string): Promise<AuditEvent | null>;
}
