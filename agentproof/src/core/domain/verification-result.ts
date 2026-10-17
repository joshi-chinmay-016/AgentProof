/**
 * AgentProof Core Domain — VerificationResult
 * 
 * Formal output of the verification engine including per-condition evaluations
 * and aggregated tri-state verdict.
 */

import { z } from 'zod';

export type Verdict = 'PASS' | 'FAIL' | 'INCONCLUSIVE';
export type VerificationVerdict = Verdict;

export interface ConditionEvaluation {
  readonly conditionId: string;
  readonly description: string;
  readonly verdict: Verdict;
  readonly reasonCode: string;
  readonly explanation: string;
  readonly expected?: unknown;
  readonly observed?: unknown;
  readonly supportingEvidenceId?: string;
}

export interface EvidenceManifestItem {
  readonly evidenceId: string;
  readonly sourceId: string;
  readonly observedAt: string;
  readonly integrityHash: string;
}

export interface VerifierIdentity {
  readonly name: string;
  readonly version: string;
}

export interface VerificationResult {
  readonly schemaVersion: '1.0.0';
  readonly verificationId: string;
  readonly requestId: string;
  readonly overallVerdict: Verdict;
  readonly summary: string;
  readonly evaluatedAt: string;
  readonly conditionEvaluations: readonly ConditionEvaluation[];
  readonly evidenceManifest: readonly EvidenceManifestItem[];
  readonly verifierIdentity: VerifierIdentity;
  readonly executionDurationMs: number;
}

export const VerdictSchema = z.enum(['PASS', 'FAIL', 'INCONCLUSIVE']);

export const ConditionEvaluationSchema = z.object({
  conditionId: z.string().min(1),
  description: z.string(),
  verdict: VerdictSchema,
  reasonCode: z.string().min(1),
  explanation: z.string(),
  expected: z.unknown().optional(),
  observed: z.unknown().optional(),
  supportingEvidenceId: z.string().optional(),
});

export const EvidenceManifestItemSchema = z.object({
  evidenceId: z.string().min(1),
  sourceId: z.string().min(1),
  observedAt: z.string().datetime(),
  integrityHash: z.string().min(1),
});

export const VerificationResultSchema = z.object({
  schemaVersion: z.literal('1.0.0'),
  verificationId: z.string().min(1),
  requestId: z.string().min(1),
  overallVerdict: VerdictSchema,
  summary: z.string(),
  evaluatedAt: z.string().datetime(),
  conditionEvaluations: z.array(ConditionEvaluationSchema),
  evidenceManifest: z.array(EvidenceManifestItemSchema),
  verifierIdentity: z.object({
    name: z.string(),
    version: z.string(),
  }),
  executionDurationMs: z.number().nonnegative(),
});
