import { describe, it, expect } from 'vitest';
import {
  EvidenceAdapter,
  ObservationRecord,
  SubscriptionRecord,
} from '../../src/simulation/index.js';
import { EvidenceSchema, ResourceTarget } from '../../src/core/index.js';

describe('EvidenceAdapter', () => {
  const adapter = new EvidenceAdapter({
    defaultSourceId: 'test-subscription-db',
  });

  const sampleTarget: ResourceTarget = {
    system: 'billing-system',
    resourceType: 'subscription',
    resourceId: 'sub-301',
    tenantId: 'tenant-omega',
  };

  const sampleRecord: SubscriptionRecord = {
    subscriptionId: 'sub-301',
    tenantId: 'tenant-omega',
    customerId: 'cust-777',
    status: 'ACTIVE',
    plan: 'starter',
    maxSeats: 3,
    features: [],
    updatedAt: '2026-10-17T12:00:00.000Z',
    revision: 1,
  };

  it('transforms a FOUND observation into a valid Phase 2 Evidence item', () => {
    const obs: ObservationRecord = {
      status: 'FOUND',
      target: sampleTarget,
      observedAt: '2026-10-17T12:00:00.000Z',
      record: sampleRecord,
      readerIdentity: 'simulated-db-replica',
    };

    const evidence = adapter.toEvidence(obs);

    expect(evidence).not.toBeNull();
    expect(EvidenceSchema.safeParse(evidence).success).toBe(true);
    expect(evidence?.sourceId).toBe('simulated-db-replica');
    expect(evidence?.sourceKind).toBe('DIRECT_READ');
    expect(evidence?.evidenceType).toBe('STATE_SNAPSHOT');
    expect(evidence?.target).toEqual(sampleTarget);
    expect(evidence?.observedPayload).toEqual(sampleRecord);
    expect(evidence?.integrityHash).toBeDefined();
    expect(evidence?.limitations).toHaveLength(0);
  });

  it('handles NOT_FOUND observation with null payload and documented limitation', () => {
    const obs: ObservationRecord = {
      status: 'NOT_FOUND',
      target: sampleTarget,
      observedAt: '2026-10-17T12:00:00.000Z',
      record: null,
      readerIdentity: 'simulated-db-replica',
    };

    const evidence = adapter.toEvidence(obs);

    expect(evidence).not.toBeNull();
    expect(EvidenceSchema.safeParse(evidence).success).toBe(true);
    expect(evidence?.observedPayload).toBeNull();
    expect(evidence?.limitations).toContain('RESOURCE_NOT_FOUND_IN_SYSTEM_OF_RECORD');
  });

  it('refuses to synthesize or fabricate evidence for READ_ERROR observations', () => {
    const obs: ObservationRecord = {
      status: 'READ_ERROR',
      target: sampleTarget,
      observedAt: '2026-10-17T12:00:00.000Z',
      record: null,
      errorMessage: 'Datastore unreachable',
      readerIdentity: 'simulated-db-replica',
    };

    const evidence = adapter.toEvidence(obs);
    expect(evidence).toBeNull();
  });

  it('toEvidenceList filters out failed observations while preserving valid ones', () => {
    const obs1: ObservationRecord = {
      status: 'FOUND',
      target: sampleTarget,
      observedAt: '2026-10-17T12:00:00.000Z',
      record: sampleRecord,
      readerIdentity: 'reader-1',
    };

    const obs2: ObservationRecord = {
      status: 'READ_ERROR',
      target: { ...sampleTarget, resourceId: 'sub-other' },
      observedAt: '2026-10-17T12:00:00.000Z',
      record: null,
      errorMessage: 'Read timeout',
      readerIdentity: 'reader-1',
    };

    const list = adapter.toEvidenceList([obs1, obs2]);
    expect(list).toHaveLength(1);
    expect(list[0].target.resourceId).toBe('sub-301');
  });

  it('generates deterministic SHA-256 integrity hashes invariant to object key ordering', () => {
    const objA = {
      status: 'ACTIVE',
      plan: 'pro',
      features: ['a', 'b'],
    };

    const objB = {
      features: ['a', 'b'],
      plan: 'pro',
      status: 'ACTIVE',
    };

    const hashA = adapter.computePayloadHash(objA);
    const hashB = adapter.computePayloadHash(objB);

    expect(hashA).toBe(hashB);
    expect(hashA).toMatch(/^[a-f0-9]{64}$/);
  });
});
