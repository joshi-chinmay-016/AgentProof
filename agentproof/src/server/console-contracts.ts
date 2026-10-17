/**
 * AgentProof Web Console — Typed API Contracts
 * 
 * Formal Zod validation schemas and TypeScript types for all browser-facing
 * REST endpoints.
 */

import { z } from 'zod';

// --- Common & Error Contracts ---

export const ApiErrorCodeSchema = z.enum([
  'BAD_REQUEST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'METHOD_NOT_ALLOWED',
  'CONFLICT',
  'RATE_LIMITED',
  'PAYLOAD_TOO_LARGE',
  'VALIDATION_FAILED',
  'INTERNAL_SERVER_ERROR',
]);

export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

export const ApiErrorResponseSchema = z.object({
  error: z.object({
    code: ApiErrorCodeSchema,
    message: z.string(),
    details: z.unknown().optional(),
    timestamp: z.string().datetime(),
  }),
});

export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;

// --- Health Contracts (/healthz, /readyz) ---

export const LivenessResponseSchema = z.object({
  status: z.literal('alive'),
  uptimeSec: z.number().nonnegative(),
  timestamp: z.string().datetime(),
  pid: z.number().int().positive(),
  memoryUsageMb: z.number().nonnegative(),
});

export type LivenessResponse = z.infer<typeof LivenessResponseSchema>;

export const ReadinessResponseSchema = z.object({
  status: z.enum(['ready', 'degraded', 'not_ready']),
  timestamp: z.string().datetime(),
  subsystems: z.object({
    traceStorage: z.enum(['ready', 'unavailable']),
    auditStorage: z.enum(['ready', 'unavailable']),
    webhookStorage: z.enum(['ready', 'unavailable']),
    integrationRegistry: z.enum(['ready', 'unavailable']),
  }),
});

export type ReadinessResponse = z.infer<typeof ReadinessResponseSchema>;

// --- Verdict & Status Enums ---

export const AuthoritativeVerdictSchema = z.enum(['PASS', 'FAIL', 'INCONCLUSIVE']);
export type AuthoritativeVerdict = z.infer<typeof AuthoritativeVerdictSchema>;

export const ObservationStatusSchema = z.enum(['FOUND', 'NOT_FOUND', 'READ_ERROR', 'UNTRUSTED']);
export type ObservationStatus = z.infer<typeof ObservationStatusSchema>;

// --- Runs / Verification Explorer Contracts (/api/runs) ---

export const RunQueryFilterSchema = z.object({
  verdict: AuthoritativeVerdictSchema.optional(),
  scenarioId: z.string().optional(),
  system: z.string().optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
  since: z.string().datetime().optional(),
});

export type RunQueryFilter = z.infer<typeof RunQueryFilterSchema>;

export const RunSummaryItemSchema = z.object({
  traceId: z.string(),
  requestId: z.string(),
  operation: z.string(),
  summary: z.string(),
  target: z.object({
    system: z.string(),
    resourceType: z.string(),
    resourceId: z.string(),
    tenantId: z.string().optional(),
  }),
  verdict: AuthoritativeVerdictSchema,
  evaluatedAt: z.string().datetime(),
  resultSummary: z.string(),
  conditionCount: z.number().int().nonnegative(),
  passedConditions: z.number().int().nonnegative(),
  failedConditions: z.number().int().nonnegative(),
  inconclusiveConditions: z.number().int().nonnegative(),
  evidenceCount: z.number().int().nonnegative(),
  durationMs: z.number().nonnegative(),
  isSimulation: z.boolean().default(false),
});

export type RunSummaryItem = z.infer<typeof RunSummaryItemSchema>;

export const RunListResponseSchema = z.object({
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
  items: z.array(RunSummaryItemSchema),
});

export type RunListResponse = z.infer<typeof RunListResponseSchema>;

// --- Run Detail Contract (/api/runs/:id) ---

export const PostconditionEvaluationDetailSchema = z.object({
  conditionId: z.string(),
  description: z.string(),
  path: z.string(),
  operator: z.string(),
  expectedValue: z.unknown(),
  observedValue: z.unknown(),
  verdict: AuthoritativeVerdictSchema,
  reasonCode: z.string(),
  explanation: z.string(),
  supportingEvidenceId: z.string().optional(),
  observationStatus: ObservationStatusSchema.optional(),
  isDrivingCondition: z.boolean().default(false),
});

export type PostconditionEvaluationDetail = z.infer<typeof PostconditionEvaluationDetailSchema>;

export const EvidenceSourceDetailSchema = z.object({
  evidenceId: z.string(),
  sourceId: z.string(),
  sourceKind: z.string(),
  evidenceType: z.string(),
  observedAt: z.string().datetime(),
  freshnessMs: z.number().nonnegative(),
  integrityHash: z.string(),
  trustLevel: z.string(),
  observationStatus: ObservationStatusSchema.default('FOUND'),
  observedPayload: z.unknown(),
  limitations: z.array(z.string()).default([]),
});

export type EvidenceSourceDetail = z.infer<typeof EvidenceSourceDetailSchema>;

export const RunDetailResponseSchema = z.object({
  traceId: z.string(),
  requestId: z.string(),
  tenantId: z.string(),
  recordedAt: z.string().datetime(),
  evaluatedAt: z.string().datetime(),
  verdict: AuthoritativeVerdictSchema,
  summary: z.string(),
  durationMs: z.number().nonnegative(),
  isSimulation: z.boolean(),
  target: z.object({
    system: z.string(),
    resourceType: z.string(),
    resourceId: z.string(),
  }),
  intent: z.object({
    operation: z.string(),
    summary: z.string(),
  }),
  postconditions: z.array(PostconditionEvaluationDetailSchema),
  evidence: z.array(EvidenceSourceDetailSchema),
  action: z.unknown().optional(),
  linkedAuditId: z.string().optional(),
  rawTrace: z.unknown(),
});

export type RunDetailResponse = z.infer<typeof RunDetailResponseSchema>;

// --- Overview Metrics Contract (/api/overview) ---

export const AttentionItemSchema = z.object({
  id: z.string(),
  severity: z.enum(['HIGH', 'MEDIUM', 'INFO']),
  title: z.string(),
  reason: z.string(),
  targetId: z.string(),
  type: z.enum(['VERIFICATION_FAILURE', 'INCONCLUSIVE_READ', 'AUDIT_INTEGRITY', 'WEBHOOK_QUARANTINE']),
});

export type AttentionItem = z.infer<typeof AttentionItemSchema>;

export const OverviewMetricsResponseSchema = z.object({
  tenantId: z.string(),
  metrics: z.object({
    totalVerifications: z.number().int().nonnegative(),
    passCount: z.number().int().nonnegative(),
    failCount: z.number().int().nonnegative(),
    inconclusiveCount: z.number().int().nonnegative(),
    passRate: z.number().nonnegative(),
    evidenceCompletenessRate: z.number().nonnegative(),
  }),
  verdictDistribution: z.object({
    PASS: z.number().int().nonnegative(),
    FAIL: z.number().int().nonnegative(),
    INCONCLUSIVE: z.number().int().nonnegative(),
  }),
  recentActivity: z.array(z.unknown()),
  attentionItems: z.array(AttentionItemSchema),
  integrations: z.array(z.unknown()),
  auditChainStatus: z.object({
    isValid: z.boolean(),
    totalEvents: z.number().int().nonnegative(),
    verifiedAt: z.string().datetime(),
  }),
});

export type OverviewMetricsResponse = z.infer<typeof OverviewMetricsResponseSchema>;

// --- Activity Since Contract (/api/activity/since) ---

export const ActivitySinceResponseSchema = z.object({
  since: z.string().datetime(),
  generatedAt: z.string().datetime(),
  newVerificationsCount: z.number().int().nonnegative(),
  newFailuresCount: z.number().int().nonnegative(),
  newInconclusiveCount: z.number().int().nonnegative(),
  newAuditEventsCount: z.number().int().nonnegative(),
  latestRunId: z.string().nullable(),
  hasChanges: z.boolean(),
});

export type ActivitySinceResponse = z.infer<typeof ActivitySinceResponseSchema>;
