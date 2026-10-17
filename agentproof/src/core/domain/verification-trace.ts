/**
 * AgentProof Core Domain — VerificationTrace
 * 
 * Immutable audit trace linking verification request, observed evidence,
 * rule outcomes, and final result.
 */

import { z } from 'zod';
import { VerificationRequest, VerificationRequestSchema } from './verification-request.js';
import { ActionRecord, ActionRecordSchema } from './action-record.js';
import { Evidence, EvidenceSchema } from './evidence.js';
import { VerificationResult, VerificationResultSchema } from './verification-result.js';

export interface VerificationTrace {
  readonly traceId: string;
  readonly request: VerificationRequest;
  readonly action?: ActionRecord;
  readonly evidence: readonly Evidence[];
  readonly result: VerificationResult;
  readonly recordedAt: string;
}

export const VerificationTraceSchema = z.object({
  traceId: z.string().min(1),
  request: VerificationRequestSchema,
  action: ActionRecordSchema.optional(),
  evidence: z.array(EvidenceSchema),
  result: VerificationResultSchema,
  recordedAt: z.string().datetime(),
});
