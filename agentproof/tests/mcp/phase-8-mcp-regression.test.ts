/**
 * AgentProof Phase 8 — MCP Protocol Regression Test Suite
 * 
 * Verifies that the Web Console API and server do not regress any
 * existing MCP tools, schemas, or verification contracts.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { VerificationTools } from '../../src/modules/verification/verification.tools.js';
import { InMemoryTraceRegistry } from '../../src/modules/verification/trace-registry.js';
import { ScenarioCatalog } from '../../src/modules/verification/scenario-catalog.js';

describe('Phase 8 MCP Tool Regressions', () => {
  let tools: VerificationTools;
  let registry: InMemoryTraceRegistry;
  let catalog: ScenarioCatalog;

  beforeEach(() => {
    registry = new InMemoryTraceRegistry();
    catalog = new ScenarioCatalog();
    tools = new VerificationTools({
      traceRegistry: registry,
      traceRepository: registry,
      scenarioCatalog: catalog,
    });
  });

  it('preserves list_scenarios output format and counts', async () => {
    const res = await tools.listScenarios({});
    expect(res.status).toBe('success');
    expect(res.count).toBeGreaterThanOrEqual(6);
    expect(res.scenarios.some((s: any) => s.id === 'SCENARIO_A')).toBe(true);
  });

  it('preserves run_scenario deterministic execution and trace capture', async () => {
    const res = await tools.runScenario({ scenarioId: 'SCENARIO_A' });
    expect(res.status).toBe('success');
    expect(res.verificationVerdict).toBe('PASS');
    expect(res.traceId).toBeDefined();

    // Inspect trace via inspect_trace
    const traceRes = await tools.inspectTrace({ traceId: res.traceId });
    expect(traceRes.status).toBe('success');
    expect(traceRes.traceId).toBe(res.traceId);
    expect(traceRes.result.overallVerdict).toBe('PASS');
  });

  it('preserves verify_outcome postcondition evaluation semantics', async () => {
    const input = {
      target: {
        system: 'billing',
        resourceType: 'subscription',
        resourceId: 'sub-300',
      },
      intent: {
        operation: 'cancel',
        summary: 'Cancel subscription sub-300',
      },
      postconditions: [
        {
          id: 'p1',
          description: 'status must be CANCELLED',
          path: 'status',
          operator: 'EQUALS' as const,
          expectedValue: 'CANCELLED',
        },
      ],
      evidence: [
        {
          sourceId: 'audit-db',
          observedPayload: { status: 'CANCELLED' },
          target: {
            system: 'billing',
            resourceType: 'subscription',
            resourceId: 'sub-300',
          },
        },
      ],
    };

    const res = await tools.verifyOutcome(input);
    expect(res.status).toBe('success');
    expect(res.overallVerdict).toBe('PASS');
    expect(res.conditionEvaluations[0].verdict).toBe('PASS');
  });
});
