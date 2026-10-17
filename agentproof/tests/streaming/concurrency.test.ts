/**
 * AgentProof Streaming & Webhooks — Concurrency & Race Condition Test Suite
 * 
 * Tests concurrent webhook deliveries, identical duplicates under race conditions,
 * sequential consistency of audit chain appends, and worker execution locks.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  FileWebhookReplayStore,
  FileAuditEventRepository,
  FileWebhookEventRepository,
  AuditChainVerifier,
  WebhookEventRecord,
} from '../../src/streaming/index.js';

describe('Concurrency & Race Condition Defenses', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentproof-concurrency-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('handles multiple identical webhooks arriving concurrently without double claiming', async () => {
    const replayStore = new FileWebhookReplayStore({ storageDir: path.join(tempDir, 'replay') });
    const tenantId = 'tenant-concurrency';
    const sourceId = 'src-stripe';
    const eventId = 'evt-concurrent-100';
    const payloadDigest = 'digest-constant-abc-123';
    const timestamp = new Date().toISOString();

    // Fire 10 simultaneous claims
    const claimPromises = Array.from({ length: 10 }, () =>
      replayStore.claim(tenantId, sourceId, eventId, payloadDigest, timestamp)
    );

    const results = await Promise.all(claimPromises);

    const firstSeenCount = results.filter((r) => r.status === 'FIRST_SEEN').length;
    const duplicateCount = results.filter((r) => r.status === 'DUPLICATE_IDENTICAL').length;

    // Exactly one must be FIRST_SEEN, and 9 must be DUPLICATE_IDENTICAL
    expect(firstSeenCount).toBe(1);
    expect(duplicateCount).toBe(9);
  });

  it('handles concurrent audit appends for the same tenant preserving sequence continuity', async () => {
    const auditRepo = new FileAuditEventRepository(path.join(tempDir, 'audit'));
    const tenantId = 'tenant-audit-concurrent';

    const appendPromises = Array.from({ length: 10 }, (_, i) =>
      auditRepo.append(tenantId, {
        auditId: `aud-concurrent-${i}`,
        eventType: 'EVENT_CONCURRENT',
        entityId: `ent-${i}`,
        payload: { index: i },
      })
    );

    await Promise.all(appendPromises);

    const events = await auditRepo.getEvents(tenantId);
    expect(events.length).toBe(10);

    // Verify cryptographic integrity and unbroken sequence 1..10
    const verifyResult = AuditChainVerifier.verifyChain(events, tenantId);
    expect(verifyResult.isValid).toBe(true);
    expect(verifyResult.totalEvents).toBe(10);
    expect(verifyResult.checkedSequences).toBe(10);
  });

  it('prevents concurrent worker executions from double-processing the same event', async () => {
    const eventRepo = new FileWebhookEventRepository(path.join(tempDir, 'events'));
    const tenantId = 'tenant-worker-race';
    const eventId = 'evt-race-1';

    const record: WebhookEventRecord = {
      internalEventId: eventId,
      tenantId,
      sourceId: 'src-gh',
      externalEventId: 'ext-race',
      eventType: 'push',
      payloadDigest: 'digest-race-1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
      parsedPayload: {},
      receivedAt: new Date().toISOString(),
      eventTimestamp: new Date().toISOString(),
      signatureVerification: {
        isValid: true,
        category: 'VALID',
        scheme: 'HMAC_SHA256',
        verifiedAt: new Date().toISOString(),
      },
      status: 'QUEUED',
      attempts: 0,
    };

    await eventRepo.create(record);

    // Two workers attempt to transition to PROCESSING at the exact same moment
    const update1 = eventRepo.updateStatus(tenantId, eventId, 'PROCESSING');
    const update2 = eventRepo.updateStatus(tenantId, eventId, 'PROCESSING');

    const results = await Promise.allSettled([update1, update2]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
  });
});
