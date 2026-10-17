/**
 * AgentProof Observation — External State Reader Contract
 * 
 * Formal interface and observation models for reading ground truth
 * from real external production systems (REST APIs, databases, object stores).
 */

import { ResourceTarget } from '../../core/index.js';

export type ExternalObservationStatus = 
  | 'FOUND' 
  | 'NOT_FOUND' 
  | 'READ_ERROR' 
  | 'UNTRUSTED';

export interface ExternalObservationRecord {
  readonly status: ExternalObservationStatus;
  readonly target: ResourceTarget;
  readonly observedAt: string;
  readonly payload: unknown | null;
  readonly sourceId: string;
  readonly sourceType: 'REST_API' | 'POSTGRES' | 'S3_STORAGE' | 'SIMULATED';
  readonly integrationId: string;
  readonly tenantId: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly errorMessage?: string;
  readonly errorCategory?: 
    | 'TIMEOUT' 
    | 'AUTHENTICATION_FAILURE' 
    | 'AUTHORIZATION_FAILURE' 
    | 'RATE_LIMITED' 
    | 'NETWORK_ERROR' 
    | 'RESPONSE_TOO_LARGE' 
    | 'MALFORMED_PAYLOAD' 
    | 'SSRF_VIOLATION' 
    | 'QUERY_ERROR' 
    | 'NOT_FOUND' 
    | 'UNKNOWN';
  readonly limitations?: readonly string[];
}

export interface IExternalStateReader {
  readonly sourceId: string;
  readonly sourceType: 'REST_API' | 'POSTGRES' | 'S3_STORAGE' | 'SIMULATED';
  readonly integrationId: string;
  readonly tenantId: string;

  /**
   * Independently reads the state of a resource from the external system.
   * Read-only: never modifies the observed system.
   */
  readState(target: ResourceTarget): Promise<ExternalObservationRecord>;
}
