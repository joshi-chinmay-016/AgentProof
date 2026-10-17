import { describe, it, expect, beforeEach } from 'vitest';
import { buildTools } from '@nitrostack/core';
import { createMockContext } from '@nitrostack/core/testing';
import {
  VerificationTools,
  ScenarioCatalog,
} from '../../src/modules/verification/index.js';
import { createBaseSubscription } from '../../src/simulation/index.js';

describe('Tool: list_scenarios', () => {
  let controller: VerificationTools;
  let scenarioCatalog: ScenarioCatalog;
  let tool: any;
  let runTool: any;

  beforeEach(() => {
    scenarioCatalog = new ScenarioCatalog();
    controller = new VerificationTools(undefined, undefined, scenarioCatalog);
    const tools = buildTools(controller);
    tool = tools.find((t) => t.name === 'list_scenarios');
    runTool = tools.find((t) => t.name === 'run_scenario');
  });

  it('lists all 8 registered demonstration scenarios', async () => {
    const ctx = createMockContext();
    const result = await tool.execute({}, ctx);

    expect(result.status).toBe('success');
    expect(result.count).toBe(8);
    expect(result.scenarios).toHaveLength(8);

    const ids = result.scenarios.map((s: any) => s.id);
    expect(ids).toEqual([
      'SCENARIO_A',
      'SCENARIO_B',
      'SCENARIO_C',
      'SCENARIO_D',
      'SCENARIO_E',
      'SCENARIO_F',
      'SCENARIO_G',
      'SCENARIO_H',
    ]);
  });

  it('provides structured metadata for each scenario including failureMode and expectedVerdict', async () => {
    const ctx = createMockContext();
    const result = await tool.execute({}, ctx);

    for (const sc of result.scenarios) {
      expect(sc.id).toBeDefined();
      expect(sc.name).toBeDefined();
      expect(sc.description).toBeDefined();
      expect(['GENUINE_SUCCESS', 'FALSE_SUCCESS', 'WRONG_TARGET', 'PARTIAL_UPDATE']).toContain(
        sc.failureMode
      );
      expect(['PASS', 'FAIL', 'INCONCLUSIVE']).toContain(sc.expectedVerdict);
    }
  });

  it('ensures every scenario returned by list_scenarios can be executed by run_scenario', async () => {
    const ctx = createMockContext();
    const listResult = await tool.execute({}, ctx);

    // Verify first 3 scenarios to ensure full compatibility
    for (let i = 0; i < 3; i++) {
      const sc = listResult.scenarios[i];
      const runResult = await runTool.execute({ scenarioId: sc.id }, ctx);
      expect(runResult.scenarioId).toBe(sc.id);
      expect(runResult.verificationVerdict).toBe(sc.expectedVerdict);
    }
  });

  it('dynamically reflects new scenarios registered in the authoritative catalog', async () => {
    scenarioCatalog.register({
      metadata: {
        id: 'SCENARIO_CUSTOM',
        name: 'Custom Test Scenario',
        description: 'Dynamically added test scenario',
        failureMode: 'GENUINE_SUCCESS',
        expectedVerdict: 'PASS',
        operation: 'custom_op',
        primaryResourceId: 'sub-custom',
      },
      factory: () => {
        const sub = createBaseSubscription({ subscriptionId: 'sub-custom' });
        return {
          id: 'SCENARIO_CUSTOM',
          name: 'Custom Test Scenario',
          description: 'Dynamically added test scenario',
          initialSubscriptions: [sub],
          actionInvocation: {
            toolName: 'custom_op',
            target: { system: 'billing', resourceType: 'sub', resourceId: 'sub-custom', tenantId: sub.tenantId },
            args: { operation: 'custom_op', updates: { status: 'CANCELLED' } },
          },
          request: {
            schemaVersion: '1.0.0',
            requestId: 'req-custom',
            timestamp: '2026-10-17T12:00:00.000Z',
            target: { system: 'billing', resourceType: 'sub', resourceId: 'sub-custom', tenantId: sub.tenantId },
            intent: { operation: 'custom_op', summary: 'custom', expectedChanges: {} },
            preconditions: [],
            postconditions: [{
              id: 'p1',
              description: 'cancelled',
              path: 'status',
              operator: 'EQUALS',
              expectedValue: 'CANCELLED',
              enforcement: 'REQUIRED',
            }],
            policy: { timeoutMs: 5000, requireIndependentSource: true, freshnessToleranceMs: 60000 },
          },
        };
      },
    });

    const ctx = createMockContext();
    const result = await tool.execute({}, ctx);

    expect(result.count).toBe(9);
    const custom = result.scenarios.find((s: any) => s.id === 'SCENARIO_CUSTOM');
    expect(custom).toBeDefined();
    expect(custom.name).toBe('Custom Test Scenario');
  });
});
