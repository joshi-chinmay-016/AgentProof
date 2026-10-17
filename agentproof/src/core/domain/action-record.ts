/**
 * AgentProof Core Domain — ActionRecord
 * 
 * Captures the claimed tool action executed by an agent.
 * Note: An executionStatus of REPORTED_SUCCESS does not constitute proof of outcome.
 */

import { z } from 'zod';
import { ResourceTarget, ResourceTargetSchema } from './verification-request.js';

export type ActionExecutionStatus = 
  | 'REPORTED_SUCCESS' 
  | 'REPORTED_FAILURE' 
  | 'ERRORED' 
  | 'UNKNOWN';

export interface ActionRecord {
  readonly actionId: string;
  readonly toolName: string;
  readonly target: ResourceTarget;
  readonly sanitizedArgs: Record<string, unknown>;
  readonly executionStatus: ActionExecutionStatus;
  readonly reportedResult: unknown;
  readonly invokedAt: string;
  readonly completedAt: string;
  readonly agentId?: string;
}

export const ActionExecutionStatusSchema = z.enum([
  'REPORTED_SUCCESS',
  'REPORTED_FAILURE',
  'ERRORED',
  'UNKNOWN',
]);

export const ActionRecordSchema = z.object({
  actionId: z.string().min(1, 'actionId must be specified'),
  toolName: z.string().min(1, 'toolName must be specified'),
  target: ResourceTargetSchema,
  sanitizedArgs: z.record(z.unknown()).default({}),
  executionStatus: ActionExecutionStatusSchema,
  reportedResult: z.unknown().optional(),
  invokedAt: z.string().datetime({ message: 'invokedAt must be a valid ISO-8601 string' }),
  completedAt: z.string().datetime({ message: 'completedAt must be a valid ISO-8601 string' }),
  agentId: z.string().optional(),
});
