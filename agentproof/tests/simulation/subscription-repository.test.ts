import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemorySubscriptionRepository,
  SubscriptionRecord,
  DeterministicClock,
} from '../../src/simulation/index.js';

describe('InMemorySubscriptionRepository', () => {
  let clock: DeterministicClock;
  let repo: InMemorySubscriptionRepository;

  const sampleRecord: SubscriptionRecord = {
    subscriptionId: 'sub-101',
    tenantId: 'tenant-acme',
    customerId: 'cust-900',
    status: 'ACTIVE',
    plan: 'enterprise',
    maxSeats: 10,
    features: ['sso', 'analytics'],
    updatedAt: '2026-10-17T12:00:00.000Z',
    revision: 1,
  };

  beforeEach(() => {
    clock = new DeterministicClock('2026-10-17T12:00:00.000Z');
    repo = new InMemorySubscriptionRepository(clock);
  });

  it('seeds and retrieves a subscription record by tenant and id', () => {
    repo.seed([sampleRecord]);

    const retrieved = repo.getById('tenant-acme', 'sub-101');
    expect(retrieved).not.toBeNull();
    expect(retrieved?.subscriptionId).toBe('sub-101');
    expect(retrieved?.status).toBe('ACTIVE');
    expect(retrieved?.plan).toBe('enterprise');
    expect(retrieved?.revision).toBe(1);
  });

  it('returns null when querying a nonexistent subscription', () => {
    repo.seed([sampleRecord]);

    const missing = repo.getById('tenant-acme', 'sub-nonexistent');
    expect(missing).toBeNull();
  });

  it('enforces tenant isolation during retrieval', () => {
    repo.seed([sampleRecord]);

    // Same subscriptionId, different tenantId
    const crossTenant = repo.getById('tenant-other', 'sub-101');
    expect(crossTenant).toBeNull();

    // getAllByTenant only returns records for the queried tenant
    const acmeRecords = repo.getAllByTenant('tenant-acme');
    expect(acmeRecords).toHaveLength(1);

    const otherRecords = repo.getAllByTenant('tenant-other');
    expect(otherRecords).toHaveLength(0);
  });

  it('guarantees immutability via deep cloning on reads', () => {
    repo.seed([sampleRecord]);

    const retrieved = repo.getById('tenant-acme', 'sub-101');
    expect(retrieved).not.toBeNull();

    // Mutate the returned object directly
    (retrieved as any).status = 'CANCELLED';
    (retrieved as any).features.push('malicious_feature');

    // Read again from repository; ground truth must remain unchanged
    const freshlyRead = repo.getById('tenant-acme', 'sub-101');
    expect(freshlyRead?.status).toBe('ACTIVE');
    expect(freshlyRead?.features).toEqual(['sso', 'analytics']);
  });

  it('updates a subscription, incrementing revision and updating timestamp', () => {
    repo.seed([sampleRecord]);

    clock.advance(5000); // Advance clock by 5 seconds
    const expectedTime = clock.now();

    const updated = repo.update('tenant-acme', 'sub-101', {
      status: 'CANCELLED',
      plan: 'cancelled-plan',
    });

    expect(updated.status).toBe('CANCELLED');
    expect(updated.plan).toBe('cancelled-plan');
    expect(updated.revision).toBe(2);
    expect(updated.updatedAt).toBe(expectedTime);

    // Verify stored state in repo matches updated object
    const stored = repo.getById('tenant-acme', 'sub-101');
    expect(stored?.status).toBe('CANCELLED');
    expect(stored?.revision).toBe(2);
    expect(stored?.updatedAt).toBe(expectedTime);
  });

  it('throws an error when updating a nonexistent subscription', () => {
    expect(() => {
      repo.update('tenant-acme', 'sub-ghost', { status: 'CANCELLED' });
    }).toThrow(/not found for tenant/);
  });

  it('throws an error when attempting cross-tenant updates', () => {
    repo.seed([sampleRecord]);

    expect(() => {
      repo.update('tenant-other', 'sub-101', { status: 'CANCELLED' });
    }).toThrow(/not found for tenant \[tenant-other\]/);

    // Original record under tenant-acme remains ACTIVE
    const original = repo.getById('tenant-acme', 'sub-101');
    expect(original?.status).toBe('ACTIVE');
  });

  it('resets repository state cleanly', () => {
    repo.seed([sampleRecord]);
    expect(repo.count()).toBe(1);

    repo.reset();
    expect(repo.count()).toBe(0);
    expect(repo.getById('tenant-acme', 'sub-101')).toBeNull();
  });
});
