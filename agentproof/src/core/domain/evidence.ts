/**
 * AgentProof Core Domain — Evidence
 * 
 * Represents an independently observed state snapshot or event receipt.
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
});
