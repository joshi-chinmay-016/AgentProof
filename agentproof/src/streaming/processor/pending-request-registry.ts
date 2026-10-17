/**
 * AgentProof Streaming & Webhooks — Pending Verification Request Registry
 * 
 * Stores pending verification requests waiting for asynchronous external events
 * or webhooks. Enforces strict tenant boundaries and lifecycle cleanup.
 */

import { VerificationRequest } from '../../core/domain/verification-request.js';

export interface PendingVerificationRegistration {
  readonly tenantId: string;
  readonly requestId: string;
  readonly request: VerificationRequest;
  readonly correlationId?: string;
  readonly targetResourceId: string;
  readonly targetResourceType: string;
  readonly registeredAt: string;
  readonly expiresAt?: string;
}

export interface IPendingRequestRegistry {
  register(registration: PendingVerificationRegistration): Promise<void>;
  getById(tenantId: string, requestId: string): Promise<PendingVerificationRegistration | null>;
  findByCorrelation(tenantId: string, correlationKey: string): Promise<PendingVerificationRegistration[]>;
  findByResource(tenantId: string, resourceType: string, resourceId: string): Promise<PendingVerificationRegistration[]>;
  remove(tenantId: string, requestId: string): Promise<boolean>;
  list(tenantId: string): Promise<PendingVerificationRegistration[]>;
}

export class InMemoryPendingRequestRegistry implements IPendingRequestRegistry {
  private registrations: Map<string, PendingVerificationRegistration> = new Map();

  private key(tenantId: string, requestId: string): string {
    return `${tenantId}:${requestId}`;
  }

  async register(registration: PendingVerificationRegistration): Promise<void> {
    const k = this.key(registration.tenantId, registration.requestId);
    this.registrations.set(k, { ...registration });
  }

  async getById(tenantId: string, requestId: string): Promise<PendingVerificationRegistration | null> {
    const record = this.registrations.get(this.key(tenantId, requestId));
    if (!record) return null;
    if (record.expiresAt && new Date(record.expiresAt).getTime() < Date.now()) {
      this.registrations.delete(this.key(tenantId, requestId));
      return null;
    }
    return { ...record };
  }

  async findByCorrelation(tenantId: string, correlationKey: string): Promise<PendingVerificationRegistration[]> {
    const results: PendingVerificationRegistration[] = [];
    const now = Date.now();

    for (const [k, record] of this.registrations.entries()) {
      if (record.tenantId !== tenantId) continue;
      if (record.expiresAt && new Date(record.expiresAt).getTime() < now) {
        this.registrations.delete(k);
        continue;
      }
      if (record.correlationId === correlationKey || record.requestId === correlationKey) {
        results.push({ ...record });
      }
    }
    return results;
  }

  async findByResource(
    tenantId: string,
    resourceType: string,
    resourceId: string
  ): Promise<PendingVerificationRegistration[]> {
    const results: PendingVerificationRegistration[] = [];
    const now = Date.now();

    for (const [k, record] of this.registrations.entries()) {
      if (record.tenantId !== tenantId) continue;
      if (record.expiresAt && new Date(record.expiresAt).getTime() < now) {
        this.registrations.delete(k);
        continue;
      }
      if (record.targetResourceType === resourceType && record.targetResourceId === resourceId) {
        results.push({ ...record });
      }
    }
    return results;
  }

  async remove(tenantId: string, requestId: string): Promise<boolean> {
    return this.registrations.delete(this.key(tenantId, requestId));
  }

  async list(tenantId: string): Promise<PendingVerificationRegistration[]> {
    const results: PendingVerificationRegistration[] = [];
    const now = Date.now();

    for (const [k, record] of this.registrations.entries()) {
      if (record.tenantId !== tenantId) continue;
      if (record.expiresAt && new Date(record.expiresAt).getTime() < now) {
        this.registrations.delete(k);
        continue;
      }
      results.push({ ...record });
    }
    return results;
  }
}
