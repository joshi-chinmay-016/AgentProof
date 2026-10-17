/**
 * AgentProof Streaming & Webhooks — Tamper-Evident Audit Contracts
 * 
 * Formal models for append-only audit events, cryptographically linked hash chains,
 * and asymmetric signed audit checkpoints.
 */

import { z } from 'zod';

export interface AuditEvent {
  readonly schemaVersion: '1.0.0';
  readonly auditId: string;
  readonly tenantId: string;
  readonly sequenceNumber: number;
  readonly eventType: string;
  readonly entityId: string;
  readonly timestamp: string;
  readonly payloadDigest: string;
  readonly previousDigest: string;
  readonly currentDigest: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export const GENESIS_PREVIOUS_DIGEST =
  '0000000000000000000000000000000000000000000000000000000000000000';

export interface AuditChainVerificationResult {
  readonly isValid: boolean;
  readonly totalEvents: number;
  readonly checkedSequences: number;
  readonly brokenSequence?: number;
  readonly brokenAuditId?: string;
  readonly errorCategory?:
    | 'VALID'
    | 'BROKEN_HASH_LINK'
    | 'DIGEST_MISMATCH'
    | 'SEQUENCE_GAP'
    | 'DUPLICATE_SEQUENCE'
    | 'DUPLICATE_AUDIT_ID'
    | 'UNSUPPORTED_VERSION'
    | 'EMPTY_CHAIN';
  readonly errorMessage?: string;
  readonly verifiedAt: string;
}

export interface AuditCheckpoint {
  readonly schemaVersion: '1.0.0';
  readonly checkpointId: string;
  readonly tenantId: string;
  readonly sequenceNumber: number;
  readonly chainDigest: string;
  readonly timestamp: string;
  readonly keyId: string;
  readonly signatureAlgorithm: 'RSA-SHA256';
  readonly signature: string;
}

export const AuditEventSchema = z.object({
  schemaVersion: z.literal('1.0.0'),
  auditId: z.string().min(1, 'auditId is required'),
  tenantId: z.string().min(1, 'tenantId is required'),
  sequenceNumber: z.number().int().positive('sequenceNumber must be positive integer'),
  eventType: z.string().min(1, 'eventType is required'),
  entityId: z.string().min(1, 'entityId is required'),
  timestamp: z.string().datetime({ message: 'timestamp must be ISO-8601' }),
  payloadDigest: z.string().min(64).max(64, 'payloadDigest must be 64-char hex SHA-256'),
  previousDigest: z.string().min(64).max(64, 'previousDigest must be 64-char hex SHA-256'),
  currentDigest: z.string().min(64).max(64, 'currentDigest must be 64-char hex SHA-256'),
  metadata: z.record(z.unknown()).optional(),
});

export const AuditCheckpointSchema = z.object({
  schemaVersion: z.literal('1.0.0'),
  checkpointId: z.string().min(1, 'checkpointId is required'),
  tenantId: z.string().min(1, 'tenantId is required'),
  sequenceNumber: z.number().int().positive('sequenceNumber must be positive integer'),
  chainDigest: z.string().min(64).max(64, 'chainDigest must be 64-char hex SHA-256'),
  timestamp: z.string().datetime({ message: 'timestamp must be ISO-8601' }),
  keyId: z.string().min(1, 'keyId is required'),
  signatureAlgorithm: z.literal('RSA-SHA256'),
  signature: z.string().min(1, 'signature is required'),
});
