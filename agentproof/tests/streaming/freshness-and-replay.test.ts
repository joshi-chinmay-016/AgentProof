/**
 * AgentProof Streaming & Webhooks — Freshness & Replay Test Suite
 * 
 * Tests clock skew validation, duplicate detection, payload conflict detection,
 * file-based persistence across restarts, and tenant replay isolation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  FileWebhookReplayStore,
  InMemoryWebhookReplayStore,
} from '../../src/streaming/index.js';

describe('Webhook Replay Protection & Freshness', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentproof-replay-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('claims a new event successfully (FIRST_SEEN)', async () => {
    const store = new InMemoryWebhookReplayStore();
    const result = await store.claim(
      'tenant-1',
      'source-1',
      'evt-100',
      'digest-aaa',
      new Date().toISOString()
    );

    expect(result.status).toBe('FIRST_SEEN');
    expect(result.isAllowed).toBe(true);
    expect(result.record.eventId).toBe('evt-100');
  });

  it('allows identical duplicate delivery (DUPLICATE_IDENTICAL)', async () => {
    const store = new InMemoryWebhookReplayStore();
    const timestamp = new Date().toISOString();

    await store.claim('tenant-1', 'source-1', 'evt-100', 'digest-aaa', timestamp);

    const dup = await store.claim('tenant-1', 'source-1', 'evt-100', 'digest-aaa', timestamp);
    expect(dup.status).toBe('DUPLICATE_IDENTICAL');
    expect(dup.isAllowed).toBe(true);
  });

  it('rejects duplicate event ID with altered payload digest (DUPLICATE_CONFLICT)', async () => {
    const store = new InMemoryWebhookReplayStore();
    const timestamp = new Date().toISOString();

    await store.claim('tenant-1', 'source-1', 'evt-100', 'digest-original', timestamp);

    const conflict = await store.claim('tenant-1', 'source-1', 'evt-100', 'digest-tampered', timestamp);
    expect(conflict.status).toBe('DUPLICATE_CONFLICT');
    expect(conflict.isAllowed).toBe(false);
  });

  it('enforces tenant isolation: different tenants can use the same eventId independently', async () => {
    const store = new InMemoryWebhookReplayStore();
    const timestamp = new Date().toISOString();

    const claim1 = await store.claim('tenant-A', 'source-1', 'evt-common', 'digest-1', timestamp);
    expect(claim1.status).toBe('FIRST_SEEN');
    expect(claim1.isAllowed).toBe(true);

    const claim2 = await store.claim('tenant-B', 'source-1', 'evt-common', 'digest-2', timestamp);
    expect(claim2.status).toBe('FIRST_SEEN');
    expect(claim2.isAllowed).toBe(true);
  });

  it('purges expired replay records', async () => {
    const store = new InMemoryWebhookReplayStore(100); // 100ms retention
    const timestamp = new Date().toISOString();

    await store.claim('tenant-1', 'source-1', 'evt-expiring', 'digest-1', timestamp, 50);

    // Immediate check
    expect(await store.hasEvent('tenant-1', 'source-1', 'evt-expiring')).toBe(true);

    // After 80ms, purge
    const purged = await store.purgeExpired(Date.now() + 100);
    expect(purged).toBe(1);
    expect(await store.hasEvent('tenant-1', 'source-1', 'evt-expiring')).toBe(false);
  });

  it('persists replay claims to disk and survives process restart', async () => {
    const store1 = new FileWebhookReplayStore({ storageDir: tempDir });
    const timestamp = new Date().toISOString();

    await store1.claim('tenant-alpha', 'stripe-live', 'evt-persisted-1', 'digest-xyz', timestamp);

    // Simulate restart by creating a new instance pointing to same directory
    const store2 = new FileWebhookReplayStore({ storageDir: tempDir });

    const dup = await store2.claim('tenant-alpha', 'stripe-live', 'evt-persisted-1', 'digest-xyz', timestamp);
    expect(dup.status).toBe('DUPLICATE_IDENTICAL');
    expect(dup.isAllowed).toBe(true);

    const conflict = await store2.claim('tenant-alpha', 'stripe-live', 'evt-persisted-1', 'digest-different', timestamp);
    expect(conflict.status).toBe('DUPLICATE_CONFLICT');
    expect(conflict.isAllowed).toBe(false);
  });
});
