import { describe, it, expect, beforeEach } from 'vitest';
import { buildTools } from '@nitrostack/core';
import { createMockContext } from '@nitrostack/core/testing';
import {
  VerificationTools,
  InMemoryTraceRegistry,
} from '../../src/modules/verification/index.js';
import { VerificationTrace } from '../../src/core/index.js';

describe('Tool: inspect_trace', () => {
  let controller: VerificationTools;
  let traceRegistry: InMemoryTraceRegistry;
  let tool: any;

  const mockTrace: VerificationTrace = {
    traceId: 'trace-12345',
    request: {
      schemaVersion: '1.0.0',
      requestId: 'req-001',
      timestamp: '2026-10-17T12:00:00.000Z',
      target: {
        system: 'billing',
        resourceType: 'subscription',
        resourceId: 'sub-500',
        tenantId: 'tenant-alpha',
      },
      intent: {
        operation: 'cancel',
        summary: 'cancel subscription',
        expectedChanges: { status: 'CANCELLED' },
      },
      preconditions: [],
      postconditions: [
        {
          id: 'post-1',
          description: 'status must be CANCELLED',
          path: 'status',
          operator: 'EQUALS',
          expectedValue: 'CANCELLED',
          enforcement: 'REQUIRED',
        },
      ],
      policy: {
        timeoutMs: 5000,
        requireIndependentSource: true,
        freshnessToleranceMs: 60000,
      },
    },
    action: {
      actionId: 'act-001',
      toolName: 'cancel',
      target: {
        system: 'billing',
        resourceType: 'subscription',
        resourceId: 'sub-500',
        tenantId: 'tenant-alpha',
      },
      sanitizedArgs: {},
      executionStatus: 'REPORTED_SUCCESS',
      reportedResult: { ok: true },
      invokedAt: '2026-10-17T12:00:00.000Z',
      completedAt: '2026-10-17T12:00:00.010Z',
    },
    evidence: [
      {
        evidenceId: 'ev-001',
        evidenceType: 'STATE_SNAPSHOT',
        sourceId: 'db',
        sourceKind: 'DIRECT_READ',
        target: {
          system: 'billing',
          resourceType: 'subscription',
          resourceId: 'sub-500',
          tenantId: 'tenant-alpha',
        },
        observedPayload: { status: 'CANCELLED' },
        observedAt: '2026-10-17T12:00:00.020Z',
        freshnessMs: 0,
        integrityHash: 'abc123hash',
        limitations: [],
      },
    ],
    result: {
      schemaVersion: '1.0.0',
      verificationId: 'ver-001',
      requestId: 'req-001',
      overallVerdict: 'PASS',
      summary: 'All conditions satisfied',
      evaluatedAt: '2026-10-17T12:00:00.030Z',
      conditionEvaluations: [],
      evidenceManifest: [],
      verifierIdentity: { name: 'AgentProof-Core', version: '1.0.0' },
      executionDurationMs: 1.5,
    },
    recordedAt: '2026-10-17T12:00:00.040Z',
  };

  beforeEach(() => {
    traceRegistry = new InMemoryTraceRegistry();
    traceRegistry.save(mockTrace);
    controller = new VerificationTools(undefined, traceRegistry);
    const tools = buildTools(controller);
    tool = tools.find((t) => t.name === 'inspect_trace');
  });

  it('retrieves an existing trace by traceId', async () => {
    const ctx = createMockContext();
    const result = await tool.execute({ traceId: 'trace-12345' }, ctx);

    expect(result.status).toBe('success');
    expect(result.traceId).toBe('trace-12345');
    expect(result.request.requestId).toBe('req-001');
    expect(result.result.overallVerdict).toBe('PASS');
    expect(result.evidence).toHaveLength(1);
    expect(result.action.toolName).toBe('cancel');
  });

  it('throws an error when traceId is not found in memory', async () => {
    const ctx = createMockContext();
    await expect(tool.execute({ traceId: 'trace-ghost' }, ctx)).rejects.toThrow(
      /Trace not found/
    );
  });

  it('enforces tenant isolation, rejecting access if tenantId mismatches', async () => {
    const ctx = createMockContext();

    // Querying with matching tenantId succeeds
    const allowed = await tool.execute(
      { traceId: 'trace-12345', tenantId: 'tenant-alpha' },
      ctx
    );
    expect(allowed.traceId).toBe('trace-12345');

    // Querying with foreign tenantId fails
    await expect(
      tool.execute({ traceId: 'trace-12345', tenantId: 'tenant-intruder' }, ctx)
    ).rejects.toThrow(/Trace not found.*tenant/);
  });

  it('rejects empty or missing traceId parameter', async () => {
    const ctx = createMockContext();
    await expect(tool.execute({ traceId: '' }, ctx)).rejects.toThrow();
    await expect(tool.execute({}, ctx)).rejects.toThrow();
  });
});
