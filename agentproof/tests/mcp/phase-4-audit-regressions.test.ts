import { describe, it, expect, beforeEach } from 'vitest';
import { VerificationTools, InMemoryTraceRegistry, ScenarioCatalog } from '../../src/modules/verification/index.js';
import { EvidenceAdapter } from '../../src/simulation/index.js';
import { VerificationTrace, VerificationRequest, VerificationResult } from '../../src/core/index.js';
import { AppModule } from '../../src/app.module.js';
import { getMcpAppMetadata } from '@nitrostack/core';

describe('Phase 4 Audit Regressions & Verification Integrity', () => {
  let traceRegistry: InMemoryTraceRegistry;
  let scenarioCatalog: ScenarioCatalog;
  let controller: VerificationTools;

  beforeEach(() => {
    traceRegistry = new InMemoryTraceRegistry();
    scenarioCatalog = new ScenarioCatalog();
    controller = new VerificationTools(undefined, traceRegistry, scenarioCatalog);
  });

  // F-01: Protocol Configuration Regression
  it('F-01: AppModule declares protocolVersion as legacy for reliable MCP STDIO interoperability', () => {
    const metadata = getMcpAppMetadata(AppModule);
    expect(metadata).toBeDefined();
    expect(metadata?.server?.protocolVersion).toBe('legacy');
  });

  // F-02: Concurrency Isolation Regression
  it('F-02: Simultaneous executions of SCENARIO_A and SCENARIO_B do not leak datastore state', async () => {
    const executions = [];
    for (let i = 0; i < 6; i++) {
      const scenarioId = i % 2 === 0 ? 'SCENARIO_A' : 'SCENARIO_B';
      executions.push(controller.runScenario({ scenarioId }));
    }

    const results = await Promise.all(executions);
    const verdicts = results.map((r) => r.verificationVerdict);

    const passCount = verdicts.filter((v) => v === 'PASS').length;
    const failCount = verdicts.filter((v) => v === 'FAIL').length;

    expect(passCount).toBe(3);
    expect(failCount).toBe(3);
  });

  // F-03: Trace Registry Write-Once Immutability
  it('F-03: InMemoryTraceRegistry rejects duplicate traceId to prevent silent overwriting of audit records', () => {
    const mockRequest: VerificationRequest = {
      schemaVersion: '1.0.0',
      requestId: 'req-1',
      timestamp: '2026-10-17T12:00:00.000Z',
      target: { system: 'billing', resourceType: 'sub', resourceId: 's-1' },
      intent: { operation: 'cancel', summary: 'cancel', expectedChanges: {} },
      preconditions: [],
      postconditions: [],
      policy: { timeoutMs: 5000, requireIndependentSource: true, freshnessToleranceMs: 60000 },
    };

    const mockResult: VerificationResult = {
      schemaVersion: '1.0.0',
      verificationId: 'v-1',
      requestId: 'req-1',
      overallVerdict: 'PASS',
      summary: 'PASS',
      evaluatedAt: '2026-10-17T12:00:00.000Z',
      conditionEvaluations: [],
      evidenceManifest: [],
      verifierIdentity: { name: 'test', version: '1.0.0' },
      executionDurationMs: 1,
    };

    const trace1: VerificationTrace = {
      traceId: 'trace-immutable-1',
      request: mockRequest,
      evidence: [],
      result: mockResult,
      recordedAt: '2026-10-17T12:00:00.000Z',
    };

    const trace2: VerificationTrace = {
      traceId: 'trace-immutable-1', // duplicate trace ID
      request: mockRequest,
      evidence: [],
      result: { ...mockResult, overallVerdict: 'FAIL' },
      recordedAt: '2026-10-17T12:05:00.000Z',
    };

    traceRegistry.save(trace1);
    expect(traceRegistry.count()).toBe(1);

    // Saving duplicate trace ID must throw and not overwrite
    expect(() => traceRegistry.save(trace2)).toThrow(/already exists.*immutable/);

    const stored = traceRegistry.getById('trace-immutable-1');
    expect(stored?.result.overallVerdict).toBe('PASS');
  });

  // F-04: Evidence Canonicalization Date Handling
  it('F-04: EvidenceAdapter differentiates distinct Date instances and avoids hash collisions', () => {
    const adapter = new EvidenceAdapter();
    const date1 = new Date('2020-01-01T00:00:00.000Z');
    const date2 = new Date('2099-01-01T00:00:00.000Z');

    const canonical1 = adapter.canonicalizeJson({ timestamp: date1 });
    const canonical2 = adapter.canonicalizeJson({ timestamp: date2 });

    expect(canonical1).not.toBe(canonical2);
    expect(canonical1).toContain('2020-01-01T00:00:00.000Z');
    expect(canonical2).toContain('2099-01-01T00:00:00.000Z');

    const hash1 = adapter.computePayloadHash({ timestamp: date1 });
    const hash2 = adapter.computePayloadHash({ timestamp: date2 });

    expect(hash1).not.toBe(hash2);
  });

  // F-05: Evidence Integrity Hash Mismatch Detection
  it('F-05: verifyOutcome rejects evidence when caller-supplied integrityHash does not match payload', async () => {
    const bogusHashInput = {
      target: { system: 'billing', resourceType: 'sub', resourceId: 'sub-1' },
      intent: { operation: 'cancel', summary: 'cancel sub', expectedChanges: {} },
      postconditions: [
        {
          id: 'post-1',
          description: 'status must be CANCELLED',
          path: 'status',
          operator: 'EQUALS' as const,
          expectedValue: 'CANCELLED',
        },
      ],
      evidence: [
        {
          sourceId: 'db',
          target: { system: 'billing', resourceType: 'sub', resourceId: 'sub-1' },
          observedPayload: { status: 'CANCELLED' },
          integrityHash: '0000000000000000000000000000000000000000000000000000000000000000', // Bogus hash!
        },
      ],
    };

    await expect(controller.verifyOutcome(bogusHashInput)).rejects.toThrow(
      /Integrity hash mismatch/
    );
  });

  // F-06: Strict Tenant-Scoped Trace Lookup
  it('F-06: Tenant isolation enforces strict tenant boundary and rejects cross-tenant trace access', () => {
    const traceA: VerificationTrace = {
      traceId: 'trace-tenant-A',
      request: {
        schemaVersion: '1.0.0',
        requestId: 'req-tenant-A',
        timestamp: '2026-10-17T12:00:00.000Z',
        target: { system: 'billing', resourceType: 'sub', resourceId: 'sub-A', tenantId: 'tenant-A' },
        intent: { operation: 'cancel', summary: 'cancel', expectedChanges: {} },
        preconditions: [],
        postconditions: [],
        policy: { timeoutMs: 5000, requireIndependentSource: true, freshnessToleranceMs: 60000 },
      },
      evidence: [],
      result: {
        schemaVersion: '1.0.0',
        verificationId: 'v-A',
        requestId: 'req-tenant-A',
        overallVerdict: 'PASS',
        summary: 'PASS',
        evaluatedAt: '2026-10-17T12:00:00.000Z',
        conditionEvaluations: [],
        evidenceManifest: [],
        verifierIdentity: { name: 'test', version: '1.0.0' },
        executionDurationMs: 1,
      },
      recordedAt: '2026-10-17T12:00:00.000Z',
    };

    const traceB: VerificationTrace = {
      traceId: 'trace-tenant-B',
      request: {
        schemaVersion: '1.0.0',
        requestId: 'req-tenant-B',
        timestamp: '2026-10-17T12:00:00.000Z',
        target: { system: 'billing', resourceType: 'sub', resourceId: 'sub-B', tenantId: 'tenant-B' },
        intent: { operation: 'cancel', summary: 'cancel', expectedChanges: {} },
        preconditions: [],
        postconditions: [],
        policy: { timeoutMs: 5000, requireIndependentSource: true, freshnessToleranceMs: 60000 },
      },
      evidence: [],
      result: {
        schemaVersion: '1.0.0',
        verificationId: 'v-B',
        requestId: 'req-tenant-B',
        overallVerdict: 'FAIL',
        summary: 'FAIL',
        evaluatedAt: '2026-10-17T12:00:00.000Z',
        conditionEvaluations: [],
        evidenceManifest: [],
        verifierIdentity: { name: 'test', version: '1.0.0' },
        executionDurationMs: 1,
      },
      recordedAt: '2026-10-17T12:00:00.000Z',
    };

    traceRegistry.save(traceA);
    traceRegistry.save(traceB);

    // 1. Tenant A accesses Tenant A's trace -> ALLOWED
    expect(traceRegistry.getById('trace-tenant-A', 'tenant-A')).not.toBeNull();

    // 2. Tenant A attempts to access Tenant B's trace -> DENIED
    expect(traceRegistry.getById('trace-tenant-B', 'tenant-A')).toBeNull();

    // 3. Tenant B attempts to access Tenant A's trace -> DENIED
    expect(traceRegistry.getById('trace-tenant-A', 'tenant-B')).toBeNull();

    // 4. Case-mismatched tenantId ('TENANT-A') -> DENIED
    expect(traceRegistry.getById('trace-tenant-A', 'TENANT-A')).toBeNull();
  });
});
