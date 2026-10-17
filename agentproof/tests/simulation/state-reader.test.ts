import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemorySubscriptionRepository,
  InMemoryStateReader,
  DeterministicClock,
  SubscriptionRecord,
} from '../../src/simulation/index.js';
import { ResourceTarget } from '../../src/core/index.js';

describe('InMemoryStateReader', () => {
  let clock: DeterministicClock;
  let repo: InMemorySubscriptionRepository;
  let reader: InMemoryStateReader;

  const sampleRecord: SubscriptionRecord = {
    subscriptionId: 'sub-201',
    tenantId: 'tenant-test',
    customerId: 'cust-201',
    status: 'ACTIVE',
    plan: 'premium',
    maxSeats: 15,
    features: ['api'],
    updatedAt: '2026-10-17T12:00:00.000Z',
    revision: 1,
  };

  const validTarget: ResourceTarget = {
    system: 'billing-system',
    resourceType: 'subscription',
    resourceId: 'sub-201',
    tenantId: 'tenant-test',
  };

  beforeEach(() => {
    clock = new DeterministicClock('2026-10-17T12:00:00.000Z');
    repo = new InMemorySubscriptionRepository(clock);
    repo.seed([sampleRecord]);
    reader = new InMemoryStateReader(repo, clock, 'test-state-reader');
  });

  it('reads the ground-truth state when record exists (FOUND)', async () => {
    const obs = await reader.readState(validTarget);

    expect(obs.status).toBe('FOUND');
    expect(obs.record).not.toBeNull();
    expect(obs.record?.subscriptionId).toBe('sub-201');
    expect(obs.record?.status).toBe('ACTIVE');
    expect(obs.record?.plan).toBe('premium');
    expect(obs.target).toEqual(validTarget);
    expect(obs.readerIdentity).toBe('test-state-reader');
  });

  it('explicitly returns NOT_FOUND when the target does not exist in ground truth', async () => {
    const missingTarget: ResourceTarget = {
      system: 'billing-system',
      resourceType: 'subscription',
      resourceId: 'sub-nonexistent',
      tenantId: 'tenant-test',
    };

    const obs = await reader.readState(missingTarget);

    expect(obs.status).toBe('NOT_FOUND');
    expect(obs.record).toBeNull();
    expect(obs.target).toEqual(missingTarget);
  });

  it('enforces tenant boundaries, returning NOT_FOUND if queried under wrong tenant', async () => {
    const wrongTenantTarget: ResourceTarget = {
      system: 'billing-system',
      resourceType: 'subscription',
      resourceId: 'sub-201',
      tenantId: 'tenant-foreign',
    };

    const obs = await reader.readState(wrongTenantTarget);

    expect(obs.status).toBe('NOT_FOUND');
    expect(obs.record).toBeNull();
  });

  it('returns READ_ERROR if target is missing tenantId', async () => {
    const noTenantTarget: ResourceTarget = {
      system: 'billing-system',
      resourceType: 'subscription',
      resourceId: 'sub-201',
    };

    const obs = await reader.readState(noTenantTarget);

    expect(obs.status).toBe('READ_ERROR');
    expect(obs.record).toBeNull();
    expect(obs.errorMessage).toContain('tenantId');
  });

  it('simulates controlled reader failures (READ_ERROR)', async () => {
    reader.setSimulatedError((target) =>
      target.resourceId === 'sub-201' ? 'Connection timeout to datastore replica' : null
    );

    const obs = await reader.readState(validTarget);

    expect(obs.status).toBe('READ_ERROR');
    expect(obs.record).toBeNull();
    expect(obs.errorMessage).toBe('Connection timeout to datastore replica');

    // Resetting simulated error restores normal reading
    reader.setSimulatedError(null);
    const restoredObs = await reader.readState(validTarget);
    expect(restoredObs.status).toBe('FOUND');
    expect(restoredObs.record?.subscriptionId).toBe('sub-201');
  });
});
