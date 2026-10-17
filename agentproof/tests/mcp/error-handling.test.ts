import { describe, it, expect, beforeEach } from 'vitest';
import { buildTools } from '@nitrostack/core';
import { createMockContext } from '@nitrostack/core/testing';
import {
  VerificationTools,
  InMemoryTraceRegistry,
} from '../../src/modules/verification/index.js';

describe('MCP Error Handling & Verdict Distinction', () => {
  let controller: VerificationTools;
  let traceRegistry: InMemoryTraceRegistry;
  let tools: any[];

  beforeEach(() => {
    traceRegistry = new InMemoryTraceRegistry();
    controller = new VerificationTools(undefined, traceRegistry);
    tools = buildTools(controller);
  });

  it('proves a FAIL verification outcome is a successful tool execution, not an operational error', async () => {
    const verifyTool = tools.find((t) => t.name === 'verify_outcome');
    const ctx = createMockContext();

    // A valid verification request where postcondition fails
    const result = await verifyTool.execute(
      {
        target: { system: 'billing', resourceType: 'sub', resourceId: 'sub-1' },
        intent: { operation: 'cancel', summary: 'cancel sub', expectedChanges: {} },
        postconditions: [
          {
            id: 'post-1',
            description: 'Must be CANCELLED',
            path: 'status',
            operator: 'EQUALS',
            expectedValue: 'CANCELLED',
          },
        ],
        evidence: [
          {
            sourceId: 'db',
            target: { system: 'billing', resourceType: 'sub', resourceId: 'sub-1' },
            observedPayload: { status: 'ACTIVE' }, // Contradiction
          },
        ],
      },
      ctx
    );

    // The MCP tool execution did NOT throw
    expect(result.status).toBe('success');
    // The verification verdict is FAIL
    expect(result.overallVerdict).toBe('FAIL');
    expect(result.summary).toContain('FAILED');
  });

  it('proves an INCONCLUSIVE verification outcome is a successful tool execution, not an operational error', async () => {
    const verifyTool = tools.find((t) => t.name === 'verify_outcome');
    const ctx = createMockContext();

    // Verification with no evidence
    const result = await verifyTool.execute(
      {
        target: { system: 'billing', resourceType: 'sub', resourceId: 'sub-1' },
        intent: { operation: 'cancel', summary: 'cancel sub', expectedChanges: {} },
        postconditions: [
          {
            id: 'post-1',
            description: 'Must be CANCELLED',
            path: 'status',
            operator: 'EQUALS',
            expectedValue: 'CANCELLED',
          },
        ],
        evidence: [],
      },
      ctx
    );

    expect(result.status).toBe('success');
    expect(result.overallVerdict).toBe('INCONCLUSIVE');
  });

  it('returns clean, structured error messages without leaking internal stack traces for invalid scenario', async () => {
    const runTool = tools.find((t) => t.name === 'run_scenario');
    const ctx = createMockContext();

    try {
      await runTool.execute({ scenarioId: 'NON_EXISTENT_SCENARIO' }, ctx);
      expect.fail('Should have thrown an error');
    } catch (err: any) {
      expect(err.message).toContain('Unknown scenario [NON_EXISTENT_SCENARIO]');
      expect(err.message).not.toContain('at Object.');
    }
  });

  it('returns clean, structured error messages for missing trace', async () => {
    const inspectTool = tools.find((t) => t.name === 'inspect_trace');
    const ctx = createMockContext();

    try {
      await inspectTool.execute({ traceId: 'fake-trace-id' }, ctx);
      expect.fail('Should have thrown an error');
    } catch (err: any) {
      expect(err.message).toContain('Trace not found: Trace ID [fake-trace-id]');
    }
  });
});
