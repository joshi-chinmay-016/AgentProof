/**
 * AgentProof Security — Typed Error Hierarchy
 * 
 * Defines explicit typed security, authorization, and persistence errors.
 * Ensures internal secrets, filesystem paths, and sensitive payloads are never leaked.
 */

export class SecurityError extends Error {
  constructor(message: string, public readonly code: string) {
    super(message);
    this.name = 'SecurityError';
  }
}

export class AuthenticationError extends SecurityError {
  constructor(message: string = 'Authentication required: caller identity could not be established.') {
    super(message, 'AUTHENTICATION_REQUIRED');
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends SecurityError {
  constructor(message: string = 'Access denied: principal lacks required permission.') {
    super(message, 'PERMISSION_DENIED');
    this.name = 'AuthorizationError';
  }
}

export class TenantAccessDeniedError extends SecurityError {
  constructor(
    public readonly requestedTenantId?: string,
    public readonly authorizedTenantId?: string,
    message: string = 'Tenant isolation violation: requested tenant scope does not match authorized principal context.'
  ) {
    super(message, 'TENANT_MISMATCH');
    this.name = 'TenantAccessDeniedError';
  }
}

export class StorageError extends Error {
  constructor(message: string, public readonly code: string = 'STORAGE_ERROR') {
    super(message);
    this.name = 'StorageError';
  }
}

export class DuplicateTraceError extends StorageError {
  constructor(public readonly traceId: string) {
    super(
      `Trace with ID [${traceId}] already exists. Verification traces are immutable audit records and cannot be overwritten.`,
      'DUPLICATE_TRACE'
    );
    this.name = 'DuplicateTraceError';
  }
}

export class CorruptedRecordError extends StorageError {
  constructor(public readonly recordId: string, message: string = 'Stored record checksum or schema verification failed.') {
    super(`Integrity fault for record [${recordId}]: ${message}`, 'CORRUPTED_RECORD');
    this.name = 'CorruptedRecordError';
  }
}

export class TraceNotFoundError extends StorageError {
  constructor(public readonly traceId: string) {
    super(`Trace [${traceId}] was not found in the authorized tenant scope.`, 'TRACE_NOT_FOUND');
    this.name = 'TraceNotFoundError';
  }
}

export class EvidenceTrustError extends Error {
  constructor(message: string, public readonly code: string = 'EVIDENCE_UNTRUSTED') {
    super(message);
    this.name = 'EvidenceTrustError';
  }
}
