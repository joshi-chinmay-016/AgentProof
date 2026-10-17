/**
 * AgentProof Core Domain — Evidence
 * 
 * Represents an independently observed state snapshot or event receipt.
 * Models provenance, trust classification, and observation metadata.
 */

import { z } from 'zod';
import { ResourceTarget, ResourceTargetSchema } from './verification-request.js';

export type EvidenceType = 
  | 'STATE_SNAPSHOT' 
  | 'EVENT_LOG' 
  | 'AUDIT_RECEIPT' 
  | 'SYSTEM_DIFF';

export type SourceKind = 
  | 'DIRECT_READ' 
  | 'REPLICA_READ' 
  | 'EVENT_STREAM' 
  | 'EXTERNAL_API';

export type EvidenceTrustLevel = 
  | 'UNVERIFIED' 
  | 'INTEGRITY_CHECKED' 
  | 'SOURCE_AUTHENTICATED' 
  | 'ATTESTED';

export type ObservationStatus = 
  | 'FOUND' 
  | 'NOT_FOUND' 
  | 'ERROR';

export interface EvidenceProvenance {
  readonly observerIdentity?: string;
  readonly observerType?: 'SIMULATED' | 'DIRECT' | 'AGENT' | 'ATTESTED' | 'EXTERNAL';
  readonly attestationSignature?: string;
  readonly attestationKeyId?: string;
  readonly trustLevel?: EvidenceTrustLevel;
}

export interface Evidence {
  readonly evidenceId: string;
  readonly evidenceType: EvidenceType;
  readonly sourceId: string;
  readonly sourceKind: SourceKind;
  readonly target: ResourceTarget;
  readonly observedPayload: unknown;
  readonly observedAt: string;
  readonly freshnessMs: number;
  readonly integrityHash: string;
  readonly limitations: readonly string[];
  // Phase 5: Provenance & trust extensions
  readonly digestAlgorithm?: string;
  readonly canonicalizationVersion?: string;
  readonly schemaVersion?: string;
  readonly provenance?: EvidenceProvenance;
  readonly observationStatus?: ObservationStatus;
}

export const EvidenceTypeSchema = z.enum([
  'STATE_SNAPSHOT',
  'EVENT_LOG',
  'AUDIT_RECEIPT',
  'SYSTEM_DIFF',
]);

export const SourceKindSchema = z.enum([
  'DIRECT_READ',
  'REPLICA_READ',
  'EVENT_STREAM',
  'EXTERNAL_API',
]);

export const EvidenceTrustLevelSchema = z.enum([
  'UNVERIFIED',
  'INTEGRITY_CHECKED',
  'SOURCE_AUTHENTICATED',
  'ATTESTED',
]);

export const ObservationStatusSchema = z.enum([
  'FOUND',
  'NOT_FOUND',
  'ERROR',
]);

export const EvidenceProvenanceSchema = z.object({
  observerIdentity: z.string().optional(),
  observerType: z.enum(['SIMULATED', 'DIRECT', 'AGENT', 'ATTESTED', 'EXTERNAL']).optional(),
  attestationSignature: z.string().optional(),
  attestationKeyId: z.string().optional(),
  trustLevel: EvidenceTrustLevelSchema.optional(),
});

export const EvidenceSchema = z.object({
  evidenceId: z.string().min(1, 'evidenceId must be specified'),
  evidenceType: EvidenceTypeSchema,
  sourceId: z.string().min(1, 'sourceId must be specified'),
  sourceKind: SourceKindSchema,
  target: ResourceTargetSchema,
  observedPayload: z.unknown(),
  observedAt: z.string().datetime({ message: 'observedAt must be a valid ISO-8601 string' }),
  freshnessMs: z.number().int().nonnegative().default(0),
  integrityHash: z.string().min(1, 'integrityHash must be specified'),
  limitations: z.array(z.string()).default([]),
  digestAlgorithm: z.string().default('SHA-256').optional(),
  canonicalizationVersion: z.string().default('v1').optional(),
  schemaVersion: z.string().default('1.0.0').optional(),
  provenance: EvidenceProvenanceSchema.optional(),
  observationStatus: ObservationStatusSchema.optional(),
});
