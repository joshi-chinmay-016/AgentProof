/**
 * AgentProof Simulation — Failure Injection Model
 * 
 * Defines explicit, typed failure injection configurations for simulating
 * agent action execution anomalies.
 */

import { z } from 'zod';

export type FailureMode =
  | 'GENUINE_SUCCESS'
  | 'FALSE_SUCCESS'
  | 'WRONG_TARGET'
  | 'PARTIAL_UPDATE'
  | 'GENUINE_FAILURE';

export const FailureModeSchema = z.enum([
  'GENUINE_SUCCESS',
  'FALSE_SUCCESS',
  'WRONG_TARGET',
  'PARTIAL_UPDATE',
  'GENUINE_FAILURE',
]);

export interface FailureInjectionConfig {
  readonly mode: FailureMode;
  /**
   * For WRONG_TARGET mode: the ID of the alternate subscription to mutate instead of the intended target.
   */
  readonly wrongTargetSubscriptionId?: string;
  /**
   * For PARTIAL_UPDATE mode: keys of the changes that should actually be applied, omitting the rest.
   */
  readonly partialFields?: readonly string[];
  /**
   * Optional custom error message for GENUINE_FAILURE mode.
   */
  readonly failureMessage?: string;
}

export const FailureInjectionConfigSchema = z.object({
  mode: FailureModeSchema,
  wrongTargetSubscriptionId: z.string().optional(),
  partialFields: z.array(z.string()).optional(),
  failureMessage: z.string().optional(),
}).refine(
  (data) => {
    if (data.mode === 'WRONG_TARGET' && !data.wrongTargetSubscriptionId) {
      return false;
    }
    return true;
  },
  {
    message: 'wrongTargetSubscriptionId must be specified when mode is WRONG_TARGET',
    path: ['wrongTargetSubscriptionId'],
  }
);
