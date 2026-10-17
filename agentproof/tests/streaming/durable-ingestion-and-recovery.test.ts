/**
 * AgentProof Streaming & Webhooks — Durable Ingestion & Recovery Test Suite
 * 
 * Tests event persistence, atomic disk writes, lifecycle state machine validation,
 * terminal state protection, querying, and crash recovery.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  FileWebhookEventRepository,
  WebhookEventRecord,
  InvalidStateTransitionError,
} from '../../src/streaming/index.js';

describe('Durable Ingestion & Recovery', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentproof-events-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const makeTestEvent = (
    tenantId: string = 'tenant-1',
    internalEventId: string = 'evt-int-1',
    status: any = 'QUEUED'
  ): WebhookEventRecord => ({
    internalEventId,
    tenantId,
    sourceId: 'src-gh',
    externalEventId: 'ext-999',
    eventType: 'pull_request.closed',
    payloadDigest: 'sha256-abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
    parsedPayload: { action: 'closed', number: 42 },
    receivedAt: new Date().toISOString(),
    eventTimestamp: new Date().toISOString(),
    signatureVerification: {
      isValid: true,
      category: 'VALID',
      scheme: 'HMAC_SHA256',
      verifiedAt: new Date().toISOString(),
    },
    status,
    attempts: 0,
  });

  it('durably persists a webhook event to disk and retrieves it', async () => {
    const repo = new FileWebhookEventRepository(tempDir);
    const event = makeTestEvent('tenant-prod', 'evt-101');

    await repo.create(event);
    const retrieved = await repo.getById('tenant-prod', 'evt-101');

    expect(retrieved).not.toBeNull();
    expect(retrieved?.internalEventId).toBe('evt-101');
    expect(retrieved?.status).toBe('QUEUED');
    expect(retrieved?.tenantId).toBe('tenant-prod');
  });

  it('persisted event survives repository reopening / restart', async () => {
    const repo1 = new FileWebhookEventRepository(tempDir);
    await repo1.create(makeTestEvent('tenant-beta', 'evt-restart-test'));

    // New instance pointing to same directory (simulating restart)
    const repo2 = new FileWebhookEventRepository(tempDir);
    const retrieved = await repo2.getById('tenant-beta', 'evt-restart-test');

    expect(retrieved).not.toBeNull();
    expect(retrieved?.internalEventId).toBe('evt-restart-test');
  });

  it('enforces valid lifecycle state transitions', async () => {
    const repo = new FileWebhookEventRepository(tempDir);
    await repo.create(makeTestEvent('tenant-1', 'evt-lifecycle', 'QUEUED'));

    // Valid: QUEUED -> PROCESSING
    const processing = await repo.updateStatus('tenant-1', 'evt-lifecycle', 'PROCESSING', {
      incrementAttempts: true,
    });
    expect(processing.status).toBe('PROCESSING');
    expect(processing.attempts).toBe(1);

    // Valid: PROCESSING -> COMPLETED
    const completed = await repo.updateStatus('tenant-1', 'evt-lifecycle', 'COMPLETED', {
      traceId: 'trc-12345',
      completedAt: new Date().toISOString(),
    });
    expect(completed.status).toBe('COMPLETED');
    expect(completed.traceId).toBe('trc-12345');
  });

  it('rejects invalid lifecycle state transitions and protects terminal states', async () => {
    const repo = new FileWebhookEventRepository(tempDir);
    await repo.create(makeTestEvent('tenant-1', 'evt-invalid-tr', 'QUEUED'));

    // Invalid: QUEUED -> COMPLETED directly
    await expect(
      repo.updateStatus('tenant-1', 'evt-invalid-tr', 'COMPLETED')
    ).rejects.toThrow(InvalidStateTransitionError);

    // Transition to PROCESSING then COMPLETED
    await repo.updateStatus('tenant-1', 'evt-invalid-tr', 'PROCESSING');
    await repo.updateStatus('tenant-1', 'evt-invalid-tr', 'COMPLETED');

    // Terminal: COMPLETED cannot transition to anything
    await expect(
      repo.updateStatus('tenant-1', 'evt-invalid-tr', 'PROCESSING')
    ).rejects.toThrow(InvalidStateTransitionError);
  });

  it('recovers in-flight events left in PROCESSING state upon startup/crash recovery', async () => {
    const repo = new FileWebhookEventRepository(tempDir);
    await repo.create(makeTestEvent('tenant-recovery', 'evt-crashed-1', 'QUEUED'));
    await repo.create(makeTestEvent('tenant-recovery', 'evt-crashed-2', 'QUEUED'));

    // Both enter PROCESSING
    await repo.updateStatus('tenant-recovery', 'evt-crashed-1', 'PROCESSING');
    await repo.updateStatus('tenant-recovery', 'evt-crashed-2', 'PROCESSING');

    // Simulate crash and startup recovery
    const recoveredCount = await repo.recoverInFlightEvents('tenant-recovery');
    expect(recoveredCount).toBe(2);

    const evt1 = await repo.getById('tenant-recovery', 'evt-crashed-1');
    const evt2 = await repo.getById('tenant-recovery', 'evt-crashed-2');

    expect(evt1?.status).toBe('RETRYABLE_FAILURE');
    expect(evt1?.errorCategory).toBe('SYSTEM_CRASH_RECOVERY');
    expect(evt2?.status).toBe('RETRYABLE_FAILURE');
  });

  it('queries events by tenant and status correctly', async () => {
    const repo = new FileWebhookEventRepository(tempDir);
    await repo.create(makeTestEvent('tenant-q', 'evt-q-1', 'QUEUED'));
    await repo.create(makeTestEvent('tenant-q', 'evt-q-2', 'QUEUED'));

    const pending = await repo.getPendingEvents('tenant-q');
    expect(pending.length).toBe(2);
  });
});
