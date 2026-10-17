/**
 * AgentProof Streaming & Webhooks — Core Webhook Contracts
 * 
 * Formal interfaces for webhook raw requests, signature verification results,
 * event records, and processing lifecycle statuses.
 */

import { z } from 'zod';

export type WebhookEventStatus =
  | 'RECEIVED'
  | 'VERIFIED'
  | 'QUEUED'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'RETRYABLE_FAILURE'
  | 'PERMANENT_FAILURE'
  | 'QUARANTINED';

export interface WebhookRawRequest {
  readonly path: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly rawBody: Buffer | string;
}

export type SignatureVerificationCategory =
  | 'VALID'
  | 'INVALID_SIGNATURE'
  | 'MISSING_SIGNATURE'
  | 'MALFORMED_SIGNATURE'
  | 'MISSING_SECRET'
  | 'UNSUPPORTED_SCHEME'
  | 'EXPIRED_TIMESTAMP';

export interface SignatureVerificationResult {
  readonly isValid: boolean;
  readonly category: SignatureVerificationCategory;
  readonly scheme: string;
  readonly verifiedAt: string;
  readonly signedTimestamp?: string;
  readonly signedEventId?: string;
  readonly errorMessage?: string;
}

export interface WebhookEventRecord {
  readonly internalEventId: string;
  readonly tenantId: string;
  readonly sourceId: string;
  readonly externalEventId: string;
  readonly eventType: string;
  readonly payloadDigest: string;
  readonly rawBody?: string;
  readonly parsedPayload: unknown;
  readonly receivedAt: string;
  readonly eventTimestamp: string;
  readonly signatureVerification: SignatureVerificationResult;
  readonly status: WebhookEventStatus;
  readonly attempts: number;
  readonly lastError?: string;
  readonly errorCategory?: string;
  readonly correlationId?: string;
  readonly traceId?: string;
  readonly completedAt?: string;
}

export const WebhookEventStatusSchema = z.enum([
  'RECEIVED',
  'VERIFIED',
  'QUEUED',
  'PROCESSING',
  'COMPLETED',
  'RETRYABLE_FAILURE',
  'PERMANENT_FAILURE',
  'QUARANTINED',
]);
