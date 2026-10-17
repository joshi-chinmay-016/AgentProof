/**
 * AgentProof Core Domain — VerificationRequest
 * 
 * Formal domain entities and runtime validation for verification requests.
 */

import { z } from 'zod';

export type PredicateOperator = 
  | 'EQUALS' 
  | 'NOT_EQUALS' 
  | 'GREATER_THAN' 
  | 'LESS_THAN' 
  | 'CONTAINS' 
  | 'MATCHES_REGEX' 
  | 'EXISTS' 
  | 'DOES_NOT_EXIST';

export type ConditionEnforcement = 'REQUIRED' | 'ADVISORY';

export interface ResourceTarget {
  readonly system: string;
  readonly resourceType: string;
  readonly resourceId: string;
  readonly tenantId?: string;
}

export interface IntentDeclaration {
  readonly operation: string;
  readonly summary: string;
  readonly expectedChanges: Record<string, unknown>;
}

export interface ConditionSpec {
  readonly id: string;
  readonly description: string;
  readonly path: string;
  readonly operator: PredicateOperator;
  readonly expectedValue?: unknown;
  readonly enforcement: ConditionEnforcement;
}

export interface VerificationPolicy {
  readonly timeoutMs: number;
  readonly requireIndependentSource: boolean;
  readonly freshnessToleranceMs: number;
}

export interface VerificationRequest {
  readonly schemaVersion: '1.0.0';
  readonly requestId: string;
  readonly timestamp: string;
  readonly target: ResourceTarget;
  readonly intent: IntentDeclaration;
  readonly preconditions: readonly ConditionSpec[];
  readonly postconditions: readonly ConditionSpec[];
  readonly policy: VerificationPolicy;
  readonly metadata?: Record<string, unknown>;
}

// Runtime Validation Schemas using Zod
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

export const ResourceTargetSchema = z.object({
  system: z.string().min(1, 'Target system must be a non-empty string'),
  resourceType: z.string().min(1, 'Resource type must be a non-empty string'),
  resourceId: z.string().min(1, 'Resource ID must be a non-empty string'),
  tenantId: z.string().optional(),
});

export const IntentDeclarationSchema = z.object({
  operation: z.string().min(1, 'Operation must be a non-empty string'),
  summary: z.string().min(1, 'Summary must be a non-empty string'),
  expectedChanges: z.record(z.unknown()),
});

export const ConditionSpecSchema = z.object({
  id: z.string().min(1, 'Condition ID must be a non-empty string'),
  description: z.string().min(1, 'Description must be a non-empty string'),
  path: z.string().min(1, 'Path must be a non-empty string'),
  operator: PredicateOperatorSchema,
  expectedValue: z.unknown().optional(),
  enforcement: ConditionEnforcementSchema.default('REQUIRED'),
});

export const VerificationPolicySchema = z.object({
  timeoutMs: z.number().int().positive().default(5000),
  requireIndependentSource: z.boolean().default(true),
  freshnessToleranceMs: z.number().int().nonnegative().default(60000),
});

export const VerificationRequestSchema = z.object({
  schemaVersion: z.literal('1.0.0'),
  requestId: z.string().min(1, 'requestId must be specified'),
  timestamp: z.string().datetime({ message: 'timestamp must be a valid ISO-8601 string' }),
  target: ResourceTargetSchema,
  intent: IntentDeclarationSchema,
  preconditions: z.array(ConditionSpecSchema).default([]),
  postconditions: z.array(ConditionSpecSchema).min(1, 'At least one postcondition is required'),
  policy: VerificationPolicySchema.default({
    timeoutMs: 5000,
    requireIndependentSource: true,
    freshnessToleranceMs: 60000,
  }),
  metadata: z.record(z.unknown()).optional(),
});
