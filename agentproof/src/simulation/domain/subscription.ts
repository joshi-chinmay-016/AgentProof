/**
 * AgentProof Simulation — Subscription Domain
 * 
 * Simulated subscription entity representing the ground-truth system of record.
 */

import { z } from 'zod';

export type SubscriptionStatus = 'ACTIVE' | 'CANCELLED' | 'PAST_DUE';

export interface SubscriptionRecord {
  readonly subscriptionId: string;
  readonly tenantId: string;
  readonly customerId: string;
  readonly status: SubscriptionStatus;
  readonly plan: string;
  readonly maxSeats: number;
  readonly features: readonly string[];
  readonly updatedAt: string;
  readonly revision: number;
}

export const SubscriptionStatusSchema = z.enum(['ACTIVE', 'CANCELLED', 'PAST_DUE']);

export const SubscriptionRecordSchema = z.object({
  subscriptionId: z.string().min(1, 'subscriptionId must be specified'),
  tenantId: z.string().min(1, 'tenantId must be specified'),
  customerId: z.string().min(1, 'customerId must be specified'),
  status: SubscriptionStatusSchema,
  plan: z.string().min(1, 'plan must be specified'),
  maxSeats: z.number().int().positive().default(1),
  features: z.array(z.string()).default([]),
  updatedAt: z.string().datetime({ message: 'updatedAt must be a valid ISO-8601 string' }),
  revision: z.number().int().nonnegative().default(1),
});

export type SubscriptionUpdateParams = Partial<
  Pick<SubscriptionRecord, 'status' | 'plan' | 'maxSeats' | 'features'>
>;
