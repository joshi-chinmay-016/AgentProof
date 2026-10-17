/**
 * AgentProof Streaming & Webhooks — Tamper-Evident Audit Chain & Checkpoints Test Suite
 * 
 * Tests cryptographically linked hash chains, sequence validation, tamper detection,
 * RSA-signed checkpoints, and demonstrates the mathematical limitation of local chains
 * against privileged full-history rewrites without separate checkpoints.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  FileAuditEventRepository,
  InMemoryAuditEventRepository,
  AuditChainVerifier,
  AuditCheckpointManager,
  AuditCanonicalizer,
  AuditEvent,
  GENESIS_PREVIOUS_DIGEST,
} from '../../src/streaming/index.js';

describe('Tamper-Evident Audit Chain & Checkpoints', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentproof-audit-test-'));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('appends events sequentially with valid cryptographic hash links', async () => {
    const repo = new InMemoryAuditEventRepository();
    const tenantId = 'tenant-audit-1';

    const ev1 = await repo.append(tenantId, {
      auditId: 'aud-1',
      eventType: 'TRACE_RECORDED',
      entityId: 'trc-1',
      payload: { action: 'init' },
    });

    expect(ev1.sequenceNumber).toBe(1);
    expect(ev1.previousDigest).toBe(GENESIS_PREVIOUS_DIGEST);
    expect(ev1.currentDigest).toBeDefined();

    const ev2 = await repo.append(tenantId, {
      auditId: 'aud-2',
      eventType: 'VERIFICATION_PASSED',
      entityId: 'trc-1',
      payload: { verdict: 'PASS' },
    });

    expect(ev2.sequenceNumber).toBe(2);
    expect(ev2.previousDigest).toBe(ev1.currentDigest);

    const ev3 = await repo.append(tenantId, {
      auditId: 'aud-3',
      eventType: 'SYSTEM_CHECK',
      entityId: 'trc-1',
      payload: { ok: true },
    });

    expect(ev3.sequenceNumber).toBe(3);
    expect(ev3.previousDigest).toBe(ev2.currentDigest);

    // Verify chain
    const allEvents = await repo.getEvents(tenantId);
    const result = AuditChainVerifier.verifyChain(allEvents, tenantId);

    expect(result.isValid).toBe(true);
    expect(result.totalEvents).toBe(3);
    expect(result.checkedSequences).toBe(3);
    expect(result.errorCategory).toBe('VALID');
  });

  it('detects payload tampering in audit records', async () => {
    const repo = new InMemoryAuditEventRepository();
    const tenantId = 'tenant-tamper-test';

    await repo.append(tenantId, {
      auditId: 'aud-1',
      eventType: 'TRANSFER',
      entityId: 'tx-1',
      payload: { amount: 100 },
    });

    const events = await repo.getEvents(tenantId);

    // Tamper with payloadDigest of event 1
    const tamperedEvents: AuditEvent[] = [
      {
        ...events[0],
        payloadDigest: '0000000000000000000000000000000000000000000000000000000000000000',
      },
    ];

    const result = AuditChainVerifier.verifyChain(tamperedEvents, tenantId);
    expect(result.isValid).toBe(false);
    expect(result.errorCategory).toBe('DIGEST_MISMATCH');
    expect(result.brokenSequence).toBe(1);
  });

  it('detects broken previous-digest link between chain nodes', async () => {
    const repo = new InMemoryAuditEventRepository();
    const tenantId = 'tenant-broken-link';

    const ev1 = await repo.append(tenantId, {
      auditId: 'aud-1',
      eventType: 'A',
      entityId: 'e-1',
      payload: {},
    });
    const ev2 = await repo.append(tenantId, {
      auditId: 'aud-2',
      eventType: 'B',
      entityId: 'e-2',
      payload: {},
    });

    // Forge previousDigest on ev2
    const tamperedEv2: AuditEvent = {
      ...ev2,
      previousDigest: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    };

    const result = AuditChainVerifier.verifyChain([ev1, tamperedEv2], tenantId);
    expect(result.isValid).toBe(false);
    expect(result.errorCategory).toBe('BROKEN_HASH_LINK');
    expect(result.brokenSequence).toBe(2);
  });

  it('detects removed events (sequence gap)', async () => {
    const repo = new InMemoryAuditEventRepository();
    const tenantId = 'tenant-gap';

    const ev1 = await repo.append(tenantId, { auditId: 'aud-1', eventType: 'A', entityId: 'e-1', payload: {} });
    await repo.append(tenantId, { auditId: 'aud-2', eventType: 'B', entityId: 'e-2', payload: {} });
    const ev3 = await repo.append(tenantId, { auditId: 'aud-3', eventType: 'C', entityId: 'e-3', payload: {} });

    // Remove event 2
    const result = AuditChainVerifier.verifyChain([ev1, ev3], tenantId);
    expect(result.isValid).toBe(false);
    expect(result.errorCategory).toBe('SEQUENCE_GAP');
    expect(result.brokenSequence).toBe(3);
  });

  it('detects duplicate auditId or duplicate sequenceNumber', async () => {
    const repo = new InMemoryAuditEventRepository();
    const tenantId = 'tenant-dup';

    const ev1 = await repo.append(tenantId, { auditId: 'aud-1', eventType: 'A', entityId: 'e-1', payload: {} });

    // Duplicate sequence
    const dupSeq: AuditEvent = {
      ...ev1,
      auditId: 'aud-distinct',
    };

    const resSeq = AuditChainVerifier.verifyChain([ev1, dupSeq], tenantId);
    expect(resSeq.isValid).toBe(false);
    expect(resSeq.errorCategory).toBe('DUPLICATE_SEQUENCE');

    // Duplicate auditId
    const dupId: AuditEvent = {
      ...ev1,
      sequenceNumber: 2,
      previousDigest: ev1.currentDigest,
    };
    const resId = AuditChainVerifier.verifyChain([ev1, dupId], tenantId);
    expect(resId.isValid).toBe(false);
    expect(resId.errorCategory).toBe('DUPLICATE_AUDIT_ID');
  });

  it('persists audit events to disk and survives reload', async () => {
    const fileRepo = new FileAuditEventRepository(tempDir);
    const tenantId = 'tenant-file-audit';

    await fileRepo.append(tenantId, {
      auditId: 'aud-file-1',
      eventType: 'FILE_TEST',
      entityId: 'ent-1',
      payload: { persisted: true },
    });

    // Reopen
    const fileRepo2 = new FileAuditEventRepository(tempDir);
    const events = await fileRepo2.getEvents(tenantId);

    expect(events.length).toBe(1);
    expect(events[0].auditId).toBe('aud-file-1');

    const verifyResult = AuditChainVerifier.verifyChain(events, tenantId);
    expect(verifyResult.isValid).toBe(true);
  });

  it('creates and verifies RSA-SHA256 signed audit checkpoints', async () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const tenantId = 'tenant-checkpoint-test';
    const chainDigest = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';

    const checkpoint = AuditCheckpointManager.signCheckpoint(
      tenantId,
      10,
      chainDigest,
      'rsa-key-2026',
      privateKey
    );

    expect(checkpoint.sequenceNumber).toBe(10);
    expect(checkpoint.chainDigest).toBe(chainDigest);
    expect(checkpoint.signature).toBeDefined();

    // Verify valid signature
    const isValid = AuditCheckpointManager.verifyCheckpoint(checkpoint, publicKey);
    expect(isValid).toBe(true);

    // Tampered checkpoint fails verification
    const tampered = {
      ...checkpoint,
      sequenceNumber: 11, // Attacker changes sequence number
    };
    const isTamperedValid = AuditCheckpointManager.verifyCheckpoint(tampered, publicKey);
    expect(isTamperedValid).toBe(false);
  });

  it('demonstrates that a full-history rewrite passes local hash verification but FAILS signed checkpoint verification', async () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const tenantId = 'tenant-privilege-attack';
    const originalRepo = new InMemoryAuditEventRepository();

    const ev1 = await originalRepo.append(tenantId, {
      auditId: 'aud-orig-1',
      eventType: 'PAYMENT',
      entityId: 'pay-1',
      payload: { amount: 100 },
    });

    // Checkpoint was signed and stored externally when ev1 was head
    const trustedCheckpoint = AuditCheckpointManager.signCheckpoint(
      tenantId,
      ev1.sequenceNumber,
      ev1.currentDigest,
      'key-auth-1',
      privateKey
    );

    // Privileged attacker completely deletes database and rewrites history with forged amounts
    const rewrittenRepo = new InMemoryAuditEventRepository();
    const forgedEv1 = await rewrittenRepo.append(tenantId, {
      auditId: 'aud-forged-1',
      eventType: 'PAYMENT',
      entityId: 'pay-1',
      payload: { amount: 999999 }, // Forged amount
    });

    // 1. Locally, the rewritten chain is internally self-consistent:
    const rewrittenEvents = await rewrittenRepo.getEvents(tenantId);
    const localCheck = AuditChainVerifier.verifyChain(rewrittenEvents, tenantId);
    expect(localCheck.isValid).toBe(true); // Demonstrates local chain cannot detect full rewrite alone!

    // 2. But comparing against the separately held trusted checkpoint detects the rewrite!
    const matchesCheckpoint =
      rewrittenEvents[0].sequenceNumber === trustedCheckpoint.sequenceNumber &&
      rewrittenEvents[0].currentDigest === trustedCheckpoint.chainDigest;

    expect(matchesCheckpoint).toBe(false); // Detected! The chain digest differs!
  });
});
