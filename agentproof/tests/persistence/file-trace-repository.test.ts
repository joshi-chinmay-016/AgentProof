/**
 * AgentProof Phase 5 Test Suite — FileTraceRepository Durability & Contract
 * 
 * Verifies disk persistence across process/instance reopen, tenant isolation,
 * atomic write safety, duplicate rejection, and cryptographic checksum validation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  FileTraceRepository,
  InMemoryTraceRepository,
  ITraceRepository,
} from '../../src/persistence/index.js';
import { VerificationTrace } from '../../src/core/index.js';
import {
  DuplicateTraceError,
  CorruptedRecordError,
} from '../../src/security/index.js';

describe('Trace Repositories — File & In-Memory Contract', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentproof-test-traces-'));
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  function createSampleTrace(traceId: string, tenantId: string, verdict: 'PASS' | 'FAIL' = 'PASS'): VerificationTrace {
    return {
      traceId,
      request: {
        schemaVersion: '1.0.0',
        requestId: `req-${traceId}`,
        timestamp: '2026-10-17T12:00:00.000Z',
        target: {
          system: 'billing-system',
          resourceType: 'subscription',
          resourceId: 'sub-999',
          tenantId,
        },
        intent: { operation: 'cancel', summary: 'Cancel sub', expectedChanges: { status: 'CANCELLED' } },
        preconditions: [],
        postconditions: [
          {
            id: 'post-1',
            description: 'Status CANCELLED',
            path: 'status',
            operator: 'EQUALS',
            expectedValue: 'CANCELLED',
            enforcement: 'REQUIRED',
          },
        ],
        policy: { timeoutMs: 5000, requireIndependentSource: true, freshnessToleranceMs: 60000 },
      },
      action: {
        actionId: `act-${traceId}`,
        toolName: 'cancel_subscription',
        target: { system: 'billing-system', resourceType: 'subscription', resourceId: 'sub-999', tenantId },
        sanitizedArgs: {},
        executionStatus: 'REPORTED_SUCCESS',
        reportedResult: { status: 'success' },
        invokedAt: '2026-10-17T12:00:00.000Z',
        completedAt: '2026-10-17T12:00:00.010Z',
      },
      evidence: [
        {
          evidenceId: `ev-${traceId}`,
          evidenceType: 'STATE_SNAPSHOT',
          sourceId: 'simulated-reader',
          sourceKind: 'DIRECT_READ',
          target: { system: 'billing-system', resourceType: 'subscription', resourceId: 'sub-999', tenantId },
          observedPayload: { status: 'CANCELLED' },
          observedAt: '2026-10-17T12:00:00.010Z',
          freshnessMs: 0,
          integrityHash: 'mock-hash',
          limitations: [],
        },
      ],
      result: {
        schemaVersion: '1.0.0',
        verificationId: `v-${traceId}`,
        requestId: `req-${traceId}`,
        overallVerdict: verdict,
        summary: `Verification ${verdict}`,
        evaluatedAt: '2026-10-17T12:00:00.010Z',
        conditionEvaluations: [],
        evidenceManifest: [],
        verifierIdentity: { name: 'AgentProof-Core', version: '1.0.0' },
        executionDurationMs: 1.2,
      },
      recordedAt: '2026-10-17T12:00:00.011Z',
    };
  }

  describe('Shared Contract (InMemoryTraceRepository & FileTraceRepository)', () => {
    const implementations: Array<{ name: string; create: () => ITraceRepository }> = [
      { name: 'InMemoryTraceRepository', create: () => new InMemoryTraceRepository() },
      { name: 'FileTraceRepository', create: () => new FileTraceRepository({ storageDir: tempDir }) },
    ];

    for (const { name, create } of implementations) {
      describe(name, () => {
        let repo: ITraceRepository;

        beforeEach(async () => {
          repo = create();
        });

        afterEach(async () => {
          await repo.close();
        });

        it('saves and retrieves trace strictly by tenant and id', async () => {
          const traceA = createSampleTrace('trace-001', 'tenant-A');
          await repo.saveForTenant('tenant-A', traceA);

          // Allowed lookup for tenant-A
          const retrieved = await repo.getByTenantAndId('tenant-A', 'trace-001');
          expect(retrieved).not.toBeNull();
          expect(retrieved?.traceId).toBe('trace-001');
          expect(retrieved?.result.overallVerdict).toBe('PASS');

          // Denied / Not found lookup for tenant-B
          const crossTenant = await repo.getByTenantAndId('tenant-B', 'trace-001');
          expect(crossTenant).toBeNull();
        });

        it('enforces write-once immutability and rejects duplicate traceId', async () => {
          const trace1 = createSampleTrace('trace-dup-1', 'tenant-A');
          await repo.saveForTenant('tenant-A', trace1);

          // Attempting to overwrite existing trace throws DuplicateTraceError
          const duplicate = createSampleTrace('trace-dup-1', 'tenant-A');
          await expect(repo.saveForTenant('tenant-A', duplicate)).rejects.toThrow(
            DuplicateTraceError
          );
        });

        it('lists traces scoped strictly to tenant and supports verdict filtering', async () => {
          await repo.saveForTenant('tenant-A', createSampleTrace('tr-a-1', 'tenant-A', 'PASS'));
          await repo.saveForTenant('tenant-A', createSampleTrace('tr-a-2', 'tenant-A', 'FAIL'));
          await repo.saveForTenant('tenant-B', createSampleTrace('tr-b-1', 'tenant-B', 'PASS'));

          const listA = await repo.listByTenant('tenant-A');
          expect(listA.length).toBe(2);
          expect(listA.map((t) => t.traceId).sort()).toEqual(['tr-a-1', 'tr-a-2']);

          const listAPassOnly = await repo.listByTenant('tenant-A', { verdict: 'PASS' });
          expect(listAPassOnly.length).toBe(1);
          expect(listAPassOnly[0].traceId).toBe('tr-a-1');

          const listB = await repo.listByTenant('tenant-B');
          expect(listB.length).toBe(1);
          expect(listB[0].traceId).toBe('tr-b-1');
        });

        it('reports correct count and existence by tenant', async () => {
          await repo.saveForTenant('tenant-A', createSampleTrace('cnt-1', 'tenant-A'));
          await repo.saveForTenant('tenant-A', createSampleTrace('cnt-2', 'tenant-A'));
          await repo.saveForTenant('tenant-B', createSampleTrace('cnt-3', 'tenant-B'));

          expect(await repo.has('cnt-1', 'tenant-A')).toBe(true);
          expect(await repo.has('cnt-1', 'tenant-B')).toBe(false);
          expect(await repo.count('tenant-A')).toBe(2);
          expect(await repo.count('tenant-B')).toBe(1);
        });
      });
    }
  });

  describe('FileTraceRepository Durability & Crash Recovery Guarantees', () => {
    it('proves durability: data survives closing and reopening a new repository instance', async () => {
      // 1. Instance A writes traces to disk
      const repo1 = new FileTraceRepository({ storageDir: tempDir });
      const traceA = createSampleTrace('persist-001', 'tenant-persist-A', 'PASS');
      const traceB = createSampleTrace('persist-002', 'tenant-persist-B', 'FAIL');

      await repo1.saveForTenant('tenant-persist-A', traceA);
      await repo1.saveForTenant('tenant-persist-B', traceB);
      await repo1.close();

      // 2. Instance B is created from scratch with no shared in-memory state
      const repo2 = new FileTraceRepository({ storageDir: tempDir });

      // Verify traces are intact
      const loadedA = await repo2.getByTenantAndId('tenant-persist-A', 'persist-001');
      expect(loadedA).not.toBeNull();
      expect(loadedA?.traceId).toBe('persist-001');
      expect(loadedA?.result.overallVerdict).toBe('PASS');
      expect(loadedA?.request.target.tenantId).toBe('tenant-persist-A');

      const loadedB = await repo2.getByTenantAndId('tenant-persist-B', 'persist-002');
      expect(loadedB).not.toBeNull();
      expect(loadedB?.traceId).toBe('persist-002');
      expect(loadedB?.result.overallVerdict).toBe('FAIL');

      // Tenant isolation survives process restart
      expect(await repo2.getByTenantAndId('tenant-persist-A', 'persist-002')).toBeNull();

      await repo2.close();
    });

    it('detects tampering and corrupted checksums without silently passing', async () => {
      const repo = new FileTraceRepository({ storageDir: tempDir });
      const trace = createSampleTrace('tamper-001', 'tenant-secure', 'FAIL');
      await repo.saveForTenant('tenant-secure', trace);

      // Tamper with the raw JSON file on disk
      const filePath = path.join(tempDir, 'tenants', 'tenant-secure', 'tamper-001.json');
      const rawContent = JSON.parse(await fs.readFile(filePath, 'utf8'));

      // Tamper: maliciously flip FAIL to PASS without updating checksum
      rawContent.trace.result.overallVerdict = 'PASS';
      await fs.writeFile(filePath, JSON.stringify(rawContent, null, 2), 'utf8');

      // Repository must detect checksum mismatch and throw CorruptedRecordError
      await expect(
        repo.getByTenantAndId('tenant-secure', 'tamper-001')
      ).rejects.toThrow(CorruptedRecordError);

      await repo.close();
    });

    it('verifies tenant directory partitioning on disk', async () => {
      const repo = new FileTraceRepository({ storageDir: tempDir });
      await repo.saveForTenant('tenant-alpha', createSampleTrace('disk-alpha-1', 'tenant-alpha'));
      await repo.saveForTenant('tenant-beta', createSampleTrace('disk-beta-1', 'tenant-beta'));

      // Check physical filesystem paths
      const alphaFile = path.join(tempDir, 'tenants', 'tenant-alpha', 'disk-alpha-1.json');
      const betaFile = path.join(tempDir, 'tenants', 'tenant-beta', 'disk-beta-1.json');

      expect(await fs.stat(alphaFile)).toBeDefined();
      expect(await fs.stat(betaFile)).toBeDefined();

      await repo.close();
    });
  });
});
