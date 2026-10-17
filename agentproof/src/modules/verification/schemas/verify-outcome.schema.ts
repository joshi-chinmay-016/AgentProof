/**
 * AgentProof MCP Layer — verify_outcome Input Schema
 * 
 * Validates verification requests submitted by MCP clients.
 */

import { z } from 'zod';

export const PredicateOperatorSchema = z.enum([
  'EQUALS',
  'NOT_EQUALS',
  'GREATER_THAN',
  'LESS_THAN',
  'CONTAINS',
  'MATCHES_REGEX',
  'EXISTS',
  'DOES_NOT_EXIST',
]);

export const ConditionEnforcementSchema = z.enum(['REQUIRED', 'ADVISORY']);

export const TargetSchema = z.object({
  system: z.string().min(1, 'Target system must be specified'),
  resourceType: z.string().min(1, 'Target resourceType must be specified'),
  resourceId: z.string().min(1, 'Target resourceId must be specified'),
  tenantId: z.string().optional(),
});

export const IntentSchema = z.object({
  operation: z.string().min(1, 'Operation must be specified'),
  summary: z.string().min(1, 'Summary must be specified'),
  expectedChanges: z.record(z.unknown()).default({}),
});

export const ConditionInputSchema = z.object({
  id: z.string().min(1, 'Condition id must be specified'),
  description: z.string().min(1, 'Condition description must be specified'),
  path: z.string().describe('Property path on observed payload (or empty string for root)'),
  operator: PredicateOperatorSchema,
  expectedValue: z.unknown().optional(),
  enforcement: ConditionEnforcementSchema.default('REQUIRED'),
});

export const ActionInputSchema = z.object({
  actionId: z.string().optional(),
  toolName: z.string().min(1, 'toolName must be specified'),
  target: TargetSchema.optional(),
  sanitizedArgs: z.record(z.unknown()).default({}),
  executionStatus: z.enum([
    'REPORTED_SUCCESS',
    'REPORTED_FAILURE',
    'ERRORED',
    'UNKNOWN',
  ]).default('REPORTED_SUCCESS'),
  reportedResult: z.unknown().optional(),
  invokedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
  agentId: z.string().optional(),
});

export const EvidenceInputSchema = z.object({
  evidenceId: z.string().optional(),
  evidenceType: z.enum(['STATE_SNAPSHOT', 'EVENT_LOG', 'AUDIT_RECEIPT', 'SYSTEM_DIFF']).default('STATE_SNAPSHOT'),
  sourceId: z.string().min(1, 'sourceId must be specified'),
  sourceKind: z.enum(['DIRECT_READ', 'REPLICA_READ', 'EVENT_STREAM', 'EXTERNAL_API']).default('DIRECT_READ'),
  target: TargetSchema,
  observedPayload: z.unknown(),
  observedAt: z.string().datetime().optional(),
  freshnessMs: z.number().int().nonnegative().default(0),
  integrityHash: z.string().optional(),
  limitations: z.array(z.string()).default([]),
});

export const PolicyInputSchema = z.object({
  timeoutMs: z.number().int().positive().default(5000),
  requireIndependentSource: z.boolean().default(true),
  freshnessToleranceMs: z.number().int().nonnegative().default(60000),
});

export const VerifyOutcomeInputSchema = z.object({
  requestId: z.string().optional().describe('Unique request identifier (auto-generated if omitted)'),
  tenantId: z.string().optional().describe('Optional tenant context scoping the verification'),
  target: TargetSchema.describe('Target resource to be verified'),
  intent: IntentSchema.describe('The operation intent and expected changes'),
  action: ActionInputSchema.optional().describe('Claimed action record from the agent'),
  postconditions: z
    .array(ConditionInputSchema)
    .min(1, 'At least one postcondition is required for verification'),
  preconditions: z.array(ConditionInputSchema).optional().default([]),
  evidence: z
    .array(EvidenceInputSchema)
    .default([])
    .describe('Array of independently acquired evidence items'),
  policy: PolicyInputSchema.optional().default({
    timeoutMs: 5000,
    requireIndependentSource: true,
    freshnessToleranceMs: 60000,
  }),
});

export type VerifyOutcomeInput = z.infer<typeof VerifyOutcomeInputSchema>;
