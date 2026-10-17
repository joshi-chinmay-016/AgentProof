import { describe, it, expect, beforeEach } from 'vitest';
import {
  InMemorySubscriptionRepository,
  MockActionAdapter,
  DeterministicClock,
  ActionInvocation,
  SubscriptionRecord,
} from '../../src/simulation/index.js';
import { ActionRecordSchema } from '../../src/core/index.js';

describe('MockActionAdapter', () => {
  let clock: DeterministicClock;
  let repo: InMemorySubscriptionRepository;
  let adapter: MockActionAdapter;

  const baseSubA: SubscriptionRecord = {
    subscriptionId: 'sub-A',
    tenantId: 'tenant-1',
    customerId: 'cust-1',
    status: 'ACTIVE',
    plan: 'pro',
    maxSeats: 5,
    features: ['feature1'],
    updatedAt: '2026-10-17T12:00:00.000Z',
    revision: 1,
  };

  const baseSubB: SubscriptionRecord = {
    subscriptionId: 'sub-B',
    tenantId: 'tenant-1',
    customerId: 'cust-2',
    status: 'ACTIVE',
    plan: 'starter',
    maxSeats: 2,
    features: [],
    updatedAt: '2026-10-17T12:00:00.000Z',
    revision: 1,
  };

  beforeEach(() => {
    clock = new DeterministicClock('2026-10-17T12:00:00.000Z');
    repo = new InMemorySubscriptionRepository(clock);
    repo.seed([baseSubA, baseSubB]);
    adapter = new MockActionAdapter(repo, clock);
  });

  it('GENUINE_SUCCESS mutates the intended subscription and reports success', async () => {
    const invocation: ActionInvocation = {
      toolName: 'cancel_subscription',
      target: {
        system: 'billing',
        resourceType: 'subscription',
        resourceId: 'sub-A',
        tenantId: 'tenant-1',
      },
      args: {
        operation: 'cancel_subscription',
        updates: { status: 'CANCELLED' },
      },
      failureInjection: { mode: 'GENUINE_SUCCESS' },
    };

    const actionRecord = await adapter.execute(invocation);

    expect(ActionRecordSchema.safeParse(actionRecord).success).toBe(true);
    expect(actionRecord.executionStatus).toBe('REPORTED_SUCCESS');
    expect(actionRecord.target.resourceId).toBe('sub-A');

    // Verify repository ground truth was mutated
    const updated = repo.getById('tenant-1', 'sub-A');
    expect(updated?.status).toBe('CANCELLED');
    expect(updated?.revision).toBe(2);
  });

  it('FALSE_SUCCESS reports success without performing the mutation on ground truth', async () => {
    const invocation: ActionInvocation = {
      toolName: 'cancel_subscription',
      target: {
        system: 'billing',
        resourceType: 'subscription',
        resourceId: 'sub-A',
        tenantId: 'tenant-1',
      },
      args: {
        operation: 'cancel_subscription',
        updates: { status: 'CANCELLED' },
      },
      failureInjection: { mode: 'FALSE_SUCCESS' },
    };

    const actionRecord = await adapter.execute(invocation);

    // The agent claims success
    expect(actionRecord.executionStatus).toBe('REPORTED_SUCCESS');

    // But ground truth remains completely unchanged
    const current = repo.getById('tenant-1', 'sub-A');
    expect(current?.status).toBe('ACTIVE');
    expect(current?.revision).toBe(1);
  });

  it('WRONG_TARGET mutates the alternate subscription while claiming success for target', async () => {
    const invocation: ActionInvocation = {
      toolName: 'cancel_subscription',
      target: {
        system: 'billing',
        resourceType: 'subscription',
        resourceId: 'sub-A',
        tenantId: 'tenant-1',
      },
      args: {
        operation: 'cancel_subscription',
        updates: { status: 'CANCELLED' },
      },
      failureInjection: {
        mode: 'WRONG_TARGET',
        wrongTargetSubscriptionId: 'sub-B',
      },
    };

    const actionRecord = await adapter.execute(invocation);

    // Adapter claimed success for sub-A
    expect(actionRecord.executionStatus).toBe('REPORTED_SUCCESS');
    expect(actionRecord.target.resourceId).toBe('sub-A');

    // Target sub-A was NOT mutated
    const subA = repo.getById('tenant-1', 'sub-A');
    expect(subA?.status).toBe('ACTIVE');

    // Wrong target sub-B WAS mutated
    const subB = repo.getById('tenant-1', 'sub-B');
    expect(subB?.status).toBe('CANCELLED');
  });

  it('PARTIAL_UPDATE applies only the specified subset of fields', async () => {
    const invocation: ActionInvocation = {
      toolName: 'modify_subscription',
      target: {
        system: 'billing',
        resourceType: 'subscription',
        resourceId: 'sub-A',
        tenantId: 'tenant-1',
      },
      args: {
        operation: 'modify_subscription',
        updates: { status: 'CANCELLED', plan: 'enterprise' },
      },
      failureInjection: {
        mode: 'PARTIAL_UPDATE',
        partialFields: ['plan'], // status is deliberately excluded
      },
    };

    const actionRecord = await adapter.execute(invocation);

    expect(actionRecord.executionStatus).toBe('REPORTED_SUCCESS');

    const subA = repo.getById('tenant-1', 'sub-A');
    // plan was updated
    expect(subA?.plan).toBe('enterprise');
    // status was NOT updated
    expect(subA?.status).toBe('ACTIVE');
  });

  it('GENUINE_FAILURE reports failure without modifying state', async () => {
    const invocation: ActionInvocation = {
      toolName: 'cancel_subscription',
      target: {
        system: 'billing',
        resourceType: 'subscription',
        resourceId: 'sub-A',
        tenantId: 'tenant-1',
      },
      args: {
        operation: 'cancel_subscription',
        updates: { status: 'CANCELLED' },
      },
      failureInjection: {
        mode: 'GENUINE_FAILURE',
        failureMessage: 'Payment gateway rejected cancellation lock.',
      },
    };

    const actionRecord = await adapter.execute(invocation);

    expect(actionRecord.executionStatus).toBe('REPORTED_FAILURE');
    expect((actionRecord.reportedResult as any)?.error).toContain(
      'Payment gateway rejected cancellation lock.'
    );

    const subA = repo.getById('tenant-1', 'sub-A');
    expect(subA?.status).toBe('ACTIVE');
  });

  it('returns ERRORED status if tenantId is missing from target', async () => {
    const invocation: ActionInvocation = {
      toolName: 'cancel_subscription',
      target: {
        system: 'billing',
        resourceType: 'subscription',
        resourceId: 'sub-A',
      },
      args: { operation: 'cancel_subscription' },
    };

    const actionRecord = await adapter.execute(invocation);

    expect(actionRecord.executionStatus).toBe('ERRORED');
    expect((actionRecord.reportedResult as any)?.error).toContain('tenantId must be specified');
  });

  it('returns ERRORED status if wrong target subscription does not exist', async () => {
    const invocation: ActionInvocation = {
      toolName: 'cancel_subscription',
      target: {
        system: 'billing',
        resourceType: 'subscription',
        resourceId: 'sub-A',
        tenantId: 'tenant-1',
      },
      args: { operation: 'cancel_subscription', updates: { status: 'CANCELLED' } },
      failureInjection: {
        mode: 'WRONG_TARGET',
        wrongTargetSubscriptionId: 'sub-nonexistent',
      },
    };

    const actionRecord = await adapter.execute(invocation);
    expect(actionRecord.executionStatus).toBe('ERRORED');
  });
});
