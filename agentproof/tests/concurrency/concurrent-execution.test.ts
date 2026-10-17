/**
 * AgentProof Phase 5 Test Suite — Concurrent Execution & Isolation
 * 
 * Verifies parallel execution safety across tenants, concurrent verification requests,
 * race-condition handling on duplicate trace IDs, and simultaneous scenario runs.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { VerificationTools } from '../../src/modules/verification/verification.tools.js';
import { FileTraceRepository } from '../../src/persistence/index.js';
import { VerificationTrace } from '../../src/core/index.js';

describe('Concurrency & Isolation Under Load', () => {
  let tempDir: string;
  let fileRepo: FileTraceRepository;
  let controller: VerificationTools;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agentproof-test-concurrency-'));
    fileRepo = new FileTraceRepository({ storageDir: tempDir });
    controller = new VerificationTools({
      traceRepository: fileRepo,
    });
  });

  afterEach(async () => {
    await fileRepo.close();
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  it('handles multiple simultaneous verification requests from different tenants in parallel without context bleed', async () => {
    const tenants = ['tenant-finance', 'tenant-healthcare', 'tenant-retail', 'tenant-telecom'];

    const promises = tenants.map(async (tenantId, index) => {
      const input = {
        tenantId,
        target: { system: `sys-${index}`, resourceType: 'item', resourceId: `res-${index}`, tenantId },
        intent: { operation: 'update_status', summary: `Update ${tenantId}`, expectedChanges: { status: 'COMPLETE' } },
        postconditions: [
          {
            id: `post-${tenantId}`,
            description: 'Status must be COMPLETE',
            path: 'status',
            operator: 'EQUALS' as const,
            expectedValue: 'COMPLETE',
          },
        ],
        evidence: [
          {
            sourceId: 'db-reader',
            target: { system: `sys-${index}`, resourceType: 'item', resourceId: `res-${index}`, tenantId },
            observedPayload: { status: 'COMPLETE' },
          },
        ],
      };

      const result = await controller.verifyOutcome(input);
      return { tenantId, result };
    });

    const results = await Promise.all(promises);

    expect(results.length).toBe(4);
    for (const { tenantId, result } of results) {
      expect(result.status).toBe('success');
      expect(result.overallVerdict).toBe('PASS');
      expect(result.trace.request.target.tenantId).toBe(tenantId);

      // Verify trace was written durably under the correct tenant partition
      const loaded = await fileRepo.getByTenantAndId(tenantId, result.traceId);
      expect(loaded).not.toBeNull();
      expect(loaded?.request.target.tenantId).toBe(tenantId);
    }
  });

  it('handles simultaneous scenario runs concurrently without state corruption', async () => {
    // Run 6 scenarios concurrently
    const scenarioRuns = [
      controller.runScenario({ scenarioId: 'SCENARIO_A' }), // PASS
      controller.runScenario({ scenarioId: 'SCENARIO_B' }), // FAIL
      controller.runScenario({ scenarioId: 'SCENARIO_C' }), // FAIL
      controller.runScenario({ scenarioId: 'SCENARIO_D' }), // FAIL
      controller.runScenario({ scenarioId: 'SCENARIO_E' }), // INCONCLUSIVE
      controller.runScenario({ scenarioId: 'SCENARIO_F' }), // INCONCLUSIVE
    ];

    const results = await Promise.all(scenarioRuns);

    expect(results[0].verificationVerdict).toBe('PASS');
    expect(results[1].verificationVerdict).toBe('FAIL');
    expect(results[2].verificationVerdict).toBe('FAIL');
    expect(results[3].verificationVerdict).toBe('FAIL');
    expect(results[4].verificationVerdict).toBe('INCONCLUSIVE');
    expect(results[5].verificationVerdict).toBe('INCONCLUSIVE');

    // All trace IDs are unique
    const traceIds = results.map((r) => r.traceId);
    const uniqueTraceIds = new Set(traceIds);
    expect(uniqueTraceIds.size).toBe(6);
  });

  it('rejects concurrent duplicate trace writes predictably without corrupting records', async () => {
    const trace: VerificationTrace = {
      traceId: 'trace-race-condition-1',
      request: {
        schemaVersion: '1.0.0',
        requestId: 'req-race-1',
        timestamp: '2026-10-17T12:00:00.000Z',
        target: { system: 'billing', resourceType: 'sub', resourceId: 'sub-race', tenantId: 'tenant-race' },
        intent: { operation: 'cancel', summary: 'cancel', expectedChanges: {} },
        preconditions: [],
        postconditions: [],
        policy: { timeoutMs: 5000, requireIndependentSource: true, freshnessToleranceMs: 60000 },
      },
      evidence: [],
      result: {
        schemaVersion: '1.0.0',
        verificationId: 'v-race-1',
        requestId: 'req-race-1',
        overallVerdict: 'PASS',
        summary: 'PASS',
        evaluatedAt: '2026-10-17T12:00:00.000Z',
        conditionEvaluations: [],
        evidenceManifest: [],
        verifierIdentity: { name: 'core', version: '1.0.0' },
        executionDurationMs: 1,
      },
      recordedAt: '2026-10-17T12:00:00.000Z',
    };

    // Attempt to write the exact same trace concurrently multiple times
    const attempts = [
      fileRepo.saveForTenant('tenant-race', trace),
      fileRepo.saveForTenant('tenant-race', trace),
      fileRepo.saveForTenant('tenant-race', trace),
    ];

    const outcomes = await Promise.allSettled(attempts);

    const fulfilled = outcomes.filter((o) => o.status === 'fulfilled');
    const rejected = outcomes.filter((o) => o.status === 'rejected');

    // Exactly one write succeeds, the others are rejected due to duplicate immutability
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(2);

    // The stored record remains completely valid and uncorrupted
    const stored = await fileRepo.getByTenantAndId('tenant-race', 'trace-race-condition-1');
    expect(stored).not.toBeNull();
    expect(stored?.traceId).toBe('trace-race-condition-1');
  });

  it('allows inspectTrace while concurrent writes are taking place', async () => {
    // Seed initial trace
    const seedResult = await controller.verifyOutcome({
      tenantId: 'tenant-stream',
      target: { system: 'streaming', resourceType: 'media', resourceId: 'video-1', tenantId: 'tenant-stream' },
      intent: { operation: 'publish', summary: 'publish video', expectedChanges: { published: true } },
      postconditions: [
        {
          id: 'post-pub',
          description: 'Published must be true',
          path: 'published',
          operator: 'EQUALS' as const,
          expectedValue: true,
        },
      ],
      evidence: [
        {
          sourceId: 'cdn-reader',
          target: { system: 'streaming', resourceType: 'media', resourceId: 'video-1', tenantId: 'tenant-stream' },
          observedPayload: { published: true },
        },
      ],
    });

    // Run parallel reads and writes
    const concurrentOps = [
      controller.inspectTrace({ traceId: seedResult.traceId, tenantId: 'tenant-stream' }),
      controller.verifyOutcome({
        tenantId: 'tenant-other',
        target: { system: 'streaming', resourceType: 'media', resourceId: 'video-2', tenantId: 'tenant-other' },
        intent: { operation: 'publish', summary: 'publish video 2', expectedChanges: { published: true } },
        postconditions: [
          {
            id: 'post-pub-2',
            description: 'Published',
            path: 'published',
            operator: 'EQUALS' as const,
            expectedValue: true,
          },
        ],
        evidence: [
          {
            sourceId: 'cdn-reader',
            target: { system: 'streaming', resourceType: 'media', resourceId: 'video-2', tenantId: 'tenant-other' },
            observedPayload: { published: true },
          },
        ],
      }),
      controller.inspectTrace({ traceId: seedResult.traceId, tenantId: 'tenant-stream' }),
    ];

    const opResults = await Promise.all(concurrentOps);
    expect(opResults[0].traceId).toBe(seedResult.traceId);
    expect(opResults[1].status).toBe('success');
    expect(opResults[2].traceId).toBe(seedResult.traceId);
  });
});
