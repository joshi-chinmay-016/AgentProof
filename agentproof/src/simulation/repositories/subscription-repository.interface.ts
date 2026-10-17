/**
 * AgentProof Simulation — ISubscriptionRepository
 * 
 * Formal contract for reading and mutating simulated subscription records.
 */

import { SubscriptionRecord, SubscriptionUpdateParams } from '../domain/subscription.js';

export interface ISubscriptionRepository {
  /**
   * Seeds an array of subscription records into the repository.
   */
  seed(records: readonly SubscriptionRecord[]): void;

  /**
   * Retrieves a single subscription by tenant and subscription ID.
   * Returns a cloned snapshot or null if not found.
   */
  getById(tenantId: string, subscriptionId: string): SubscriptionRecord | null;

  /**
   * Retrieves all subscriptions belonging to a specific tenant.
   */
  getAllByTenant(tenantId: string): readonly SubscriptionRecord[];

  /**
   * Updates an existing subscription, incrementing its revision and updating its timestamp.
   * Throws an error if the record does not exist or tenant mismatch occurs.
   */
  update(
    tenantId: string,
    subscriptionId: string,
    changes: SubscriptionUpdateParams
  ): SubscriptionRecord;

  /**
   * Resets all repository state to clean/empty.
   */
  reset(): void;

  /**
   * Total number of stored subscriptions across all tenants.
   */
  count(): number;
}
