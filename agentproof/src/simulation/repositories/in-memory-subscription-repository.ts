/**
 * AgentProof Simulation — InMemorySubscriptionRepository
 * 
 * Thread-safe, isolated in-memory datastore representing the ground-truth system of record.
 * Guarantees immutability via deep cloning on reads and writes.
 */

import { ISubscriptionRepository } from './subscription-repository.interface.js';
import {
  SubscriptionRecord,
  SubscriptionRecordSchema,
  SubscriptionUpdateParams,
} from '../domain/subscription.js';
import { IClock, DeterministicClock } from '../domain/clock.js';

export class InMemorySubscriptionRepository implements ISubscriptionRepository {
  private readonly storage: Map<string, SubscriptionRecord> = new Map();
  private readonly clock: IClock;

  constructor(clock?: IClock) {
    this.clock = clock ?? new DeterministicClock();
  }

  public seed(records: readonly SubscriptionRecord[]): void {
    for (const record of records) {
      // Validate schema on seed
      const validated = SubscriptionRecordSchema.parse(record);
      const key = this.buildKey(validated.tenantId, validated.subscriptionId);
      this.storage.set(key, this.clone(validated));
    }
  }

  public getById(tenantId: string, subscriptionId: string): SubscriptionRecord | null {
    const key = this.buildKey(tenantId, subscriptionId);
    const found = this.storage.get(key);
    return found ? this.clone(found) : null;
  }

  public getAllByTenant(tenantId: string): readonly SubscriptionRecord[] {
    const results: SubscriptionRecord[] = [];
    for (const [key, record] of this.storage.entries()) {
      if (key.startsWith(`${tenantId}:`)) {
        results.push(this.clone(record));
      }
    }
    return results;
  }

  public update(
    tenantId: string,
    subscriptionId: string,
    changes: SubscriptionUpdateParams
  ): SubscriptionRecord {
    const key = this.buildKey(tenantId, subscriptionId);
    const existing = this.storage.get(key);

    if (!existing) {
      throw new Error(
        `Subscription [${subscriptionId}] not found for tenant [${tenantId}].`
      );
    }

    const updatedRecord: SubscriptionRecord = {
      ...existing,
      ...changes,
      revision: existing.revision + 1,
      updatedAt: this.clock.now(),
    };

    // Re-validate post-mutation state
    const validated = SubscriptionRecordSchema.parse(updatedRecord);
    this.storage.set(key, this.clone(validated));

    return this.clone(validated);
  }

  public reset(): void {
    this.storage.clear();
  }

  public count(): number {
    return this.storage.size;
  }

  private buildKey(tenantId: string, subscriptionId: string): string {
    return `${tenantId}:${subscriptionId}`;
  }

  private clone<T>(obj: T): T {
    return JSON.parse(JSON.stringify(obj));
  }
}
