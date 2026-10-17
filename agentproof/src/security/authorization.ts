/**
 * AgentProof Security — Authorization & Tenant Boundary Enforcement
 * 
 * Enforces least-privilege permission checks and strict tenant isolation
 * across all verification, trace, and simulation operations.
 */

import { SecurityPrincipal } from './identity.js';
import { AuthorizationError, TenantAccessDeniedError } from './errors.js';
import { VerificationTrace } from '../core/domain/verification-trace.js';

export const Permissions = {
  VERIFY_EXECUTE: 'verify:execute',
  TRACE_READ: 'trace:read',
  TRACE_WRITE: 'trace:write',
  SCENARIO_RUN: 'scenario:run',
  SCENARIO_EXECUTE: 'scenario:run',
  SCENARIO_LIST: 'scenario:list',
  ALL: '*',
} as const;

export type Permission = typeof Permissions[keyof typeof Permissions];

export interface IAuthorizationService {
  /**
   * Verifies that the principal has been granted permission for the requested operation.
   * Throws AuthorizationError if permission is denied.
   */
  authorizeOperation(principal: SecurityPrincipal, operation: Permission | string): void;

  /**
   * Compares the requested resource tenant scope with the principal's authorized tenant context.
   * Returns the authorized tenantId.
   * Throws TenantAccessDeniedError if a mismatch is detected.
   */
  authorizeTenantScope(principal: SecurityPrincipal, requestedTenantId?: string): string;

  /**
   * Verifies that the principal is authorized to read the specified trace.
   * Enforces tenant isolation.
   * Throws TenantAccessDeniedError or AuthorizationError on violation.
   */
  authorizeTraceAccess(principal: SecurityPrincipal, trace: VerificationTrace): void;

  /**
   * Verifies that the principal is authorized to write/persist traces for the specified tenant.
   */
  authorizeTraceWrite(principal: SecurityPrincipal, targetTenantId: string): void;
}

export class DefaultAuthorizationService implements IAuthorizationService {
  public authorizeTraceWrite(principal: SecurityPrincipal, targetTenantId: string): void {
    this.authorizeOperation(principal, Permissions.TRACE_WRITE);
    this.authorizeTenantScope(principal, targetTenantId);
  }
  public authorizeOperation(principal: SecurityPrincipal, operation: Permission | string): void {
    if (!principal) {
      throw new AuthorizationError('Authorization failure: no principal context provided.');
    }

    const perms = principal.permissions || [];
    const hasPermission = perms.includes('*') || perms.includes(operation);

    if (!hasPermission) {
      throw new AuthorizationError(
        `Access denied: principal [${principal.principalId}] lacks required permission [${operation}].`
      );
    }
  }

  public authorizeTenantScope(principal: SecurityPrincipal, requestedTenantId?: string): string {
    if (!principal || !principal.tenantId) {
      throw new TenantAccessDeniedError(requestedTenantId, undefined, 'Missing authorized tenant context on principal.');
    }

    // System/admin wildcard principal can operate across tenants if specified
    if (principal.permissions.includes('*') && requestedTenantId) {
      return requestedTenantId;
    }

    // If caller specified an explicit tenant scope, it MUST match their authorized tenant
    if (requestedTenantId && requestedTenantId !== principal.tenantId) {
      throw new TenantAccessDeniedError(
        requestedTenantId,
        principal.tenantId,
        `Tenant isolation breach: principal [${principal.principalId}] belonging to tenant [${principal.tenantId}] ` +
        `cannot access or mutate resources for foreign tenant [${requestedTenantId}].`
      );
    }

    // Default to the principal's authorized tenant
    return principal.tenantId;
  }

  public authorizeTraceAccess(principal: SecurityPrincipal, trace: VerificationTrace): void {
    this.authorizeOperation(principal, Permissions.TRACE_READ);

    const traceTenant = trace.request.target.tenantId;

    // Wildcard admin can inspect any trace
    if (principal.permissions.includes('*')) {
      return;
    }

    // If trace has an associated tenant, caller must belong to the exact same tenant
    if (traceTenant && traceTenant !== principal.tenantId) {
      // Intentionally do not leak trace details or indicate existence
      throw new TenantAccessDeniedError(
        traceTenant,
        principal.tenantId,
        `Trace not found in authorized tenant scope.`
      );
    }
  }
}
