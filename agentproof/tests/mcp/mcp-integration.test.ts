import { describe, it, expect, beforeEach } from 'vitest';
import { buildTools } from '@nitrostack/core';
import { createMockContext } from '@nitrostack/core/testing';
import {
  VerificationTools,
  InMemoryTraceRegistry,
  ScenarioCatalog,
} from '../../src/modules/verification/index.js';

describe('MCP End-to-End Integration Flows', () => {
  let controller: VerificationTools;
  let traceRegistry: InMemoryTraceRegistry;
  let scenarioCatalog: ScenarioCatalog;
  let listTool: any;
  let runTool: any;
  let inspectTool: any;
  let verifyTool: any;

  beforeEach(() => {
    traceRegistry = new InMemoryTraceRegistry();
    scenarioCatalog = new ScenarioCatalog();
    controller = new VerificationTools(undefined, traceRegistry, scenarioCatalog);
    const tools = buildTools(controller);

    listTool = tools.find((t) => t.name === 'list_scenarios');
    runTool = tools.find((t) => t.name === 'run_scenario');
    inspectTool = tools.find((t) => t.name === 'inspect_trace');
    verifyTool = tools.find((t) => t.name === 'verify_outcome');
  });

  it('Integration Flow A: Genuine Success (Discover -> Run -> PASS -> Inspect Trace)', async () => {
    const ctx = createMockContext();

    // 1. Discover available scenarios
    const catalog = await listTool.execute({}, ctx);
    expect(catalog.count).toBeGreaterThan(0);
    const scenarioA = catalog.scenarios.find((s: any) => s.id === 'SCENARIO_A');
    expect(scenarioA).toBeDefined();

    // 2. Run Genuine Success scenario
    const runResult = await runTool.execute({ scenarioId: 'SCENARIO_A' }, ctx);
    expect(runResult.status).toBe('success');
    expect(runResult.verificationVerdict).toBe('PASS');

    // 3. Inspect the stored trace
    const traceResult = await inspectTool.execute({ traceId: runResult.traceId }, ctx);
    expect(traceResult.status).toBe('success');
    expect(traceResult.traceId).toBe(runResult.traceId);
    expect(traceResult.result.overallVerdict).toBe('PASS');
    expect(traceResult.evidence).toHaveLength(1);
  });

  it('Integration Flow B: False Success (Run -> Action claims success -> Ground truth unchanged -> FAIL -> Trace explains)', async () => {
    const ctx = createMockContext();

    // 1. Run False Success scenario
    const runResult = await runTool.execute({ scenarioId: 'SCENARIO_B' }, ctx);

    // 2. Action adapter reported success
    expect(runResult.actionReportedStatus).toBe('REPORTED_SUCCESS');

    // 3. Independent observation proves state unchanged -> FAIL
    expect(runResult.verificationVerdict).toBe('FAIL');

    // 4. Retrieve trace and inspect condition evaluations
    const traceResult = await inspectTool.execute({ traceId: runResult.traceId }, ctx);
    expect(traceResult.result.overallVerdict).toBe('FAIL');
    expect(traceResult.result.conditionEvaluations[0].verdict).toBe('FAIL');
    expect(traceResult.result.conditionEvaluations[0].observed).toBe('ACTIVE');
    expect(traceResult.result.conditionEvaluations[0].expected).toBe('CANCELLED');
  });

  it('Integration Flow C: Observation Unavailable (Run -> Reader timeout -> INCONCLUSIVE -> 0 fabricated evidence)', async () => {
    const ctx = createMockContext();

    // 1. Run Observation Unavailable scenario
    const runResult = await runTool.execute({ scenarioId: 'SCENARIO_F' }, ctx);

    // 2. Verdict is INCONCLUSIVE (not false FAIL or false PASS)
    expect(runResult.verificationVerdict).toBe('INCONCLUSIVE');
    expect(runResult.evidenceCount).toBe(0);

    // 3. Inspect trace confirms 0 evidence fabricated
    const traceResult = await inspectTool.execute({ traceId: runResult.traceId }, ctx);
    expect(traceResult.result.overallVerdict).toBe('INCONCLUSIVE');
    expect(traceResult.evidence).toHaveLength(0);
  });

  it('Integration Flow D: Invalid Scenario (Safe error response -> No scenario executed)', async () => {
    const ctx = createMockContext();

    await expect(
      runTool.execute({ scenarioId: 'INVALID_SCENARIO_XYZ' }, ctx)
    ).rejects.toThrow(/Unknown scenario \[INVALID_SCENARIO_XYZ\]/);

    // No traces should have been recorded
    expect(traceRegistry.count()).toBe(0);
  });

  it('Integration Flow E: Trace Isolation (Concurrent / Multiple verifications remain distinct)', async () => {
    const ctx = createMockContext();

    // Verification 1: Tenant Alpha
    const res1 = await verifyTool.execute(
      {
        requestId: 'req-alpha-1',
        target: { system: 'billing', resourceType: 'sub', resourceId: 'sub-alpha', tenantId: 'tenant-alpha' },
        intent: { operation: 'op-1', summary: 'alpha intent', expectedChanges: {} },
        postconditions: [{ id: 'p1', description: 'check', path: 'status', operator: 'EQUALS', expectedValue: 'ACTIVE' }],
        evidence: [{
          sourceId: 'src-1',
          target: { system: 'billing', resourceType: 'sub', resourceId: 'sub-alpha', tenantId: 'tenant-alpha' },
          observedPayload: { status: 'ACTIVE' },
        }],
      },
      ctx
    );

    // Verification 2: Tenant Beta
    const res2 = await verifyTool.execute(
      {
        requestId: 'req-beta-2',
        target: { system: 'billing', resourceType: 'sub', resourceId: 'sub-beta', tenantId: 'tenant-beta' },
        intent: { operation: 'op-2', summary: 'beta intent', expectedChanges: {} },
        postconditions: [{ id: 'p2', description: 'check', path: 'status', operator: 'EQUALS', expectedValue: 'CANCELLED' }],
        evidence: [{
          sourceId: 'src-2',
          target: { system: 'billing', resourceType: 'sub', resourceId: 'sub-beta', tenantId: 'tenant-beta' },
          observedPayload: { status: 'CANCELLED' },
        }],
      },
      ctx
    );

    expect(res1.traceId).not.toBe(res2.traceId);

    // Fetching trace 1 returns Alpha
    const trace1 = await inspectTool.execute({ traceId: res1.traceId, tenantId: 'tenant-alpha' }, ctx);
    expect(trace1.request.requestId).toBe('req-alpha-1');

    // Fetching trace 2 returns Beta
    const trace2 = await inspectTool.execute({ traceId: res2.traceId, tenantId: 'tenant-beta' }, ctx);
    expect(trace2.request.requestId).toBe('req-beta-2');

    // Cross-tenant access denied
    await expect(
      inspectTool.execute({ traceId: res1.traceId, tenantId: 'tenant-beta' }, ctx)
    ).rejects.toThrow();
  });
});
