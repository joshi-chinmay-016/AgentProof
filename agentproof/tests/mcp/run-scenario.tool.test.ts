import { describe, it, expect, beforeEach } from 'vitest';
import { buildTools } from '@nitrostack/core';
import { createMockContext } from '@nitrostack/core/testing';
import {
  VerificationTools,
  InMemoryTraceRegistry,
  ScenarioCatalog,
} from '../../src/modules/verification/index.js';

describe('Tool: run_scenario', () => {
  let controller: VerificationTools;
  let traceRegistry: InMemoryTraceRegistry;
  let scenarioCatalog: ScenarioCatalog;
  let tool: any;
  let inspectTool: any;

  beforeEach(() => {
    traceRegistry = new InMemoryTraceRegistry();
    scenarioCatalog = new ScenarioCatalog();
    controller = new VerificationTools(undefined, traceRegistry, scenarioCatalog);
    const tools = buildTools(controller);
    tool = tools.find((t) => t.name === 'run_scenario');
    inspectTool = tools.find((t) => t.name === 'inspect_trace');
  });

  it('Scenario A: executes Genuine Success and returns PASS', async () => {
    const ctx = createMockContext();
    const result = await tool.execute({ scenarioId: 'SCENARIO_A' }, ctx);

    expect(result.status).toBe('success');
    expect(result.scenarioId).toBe('SCENARIO_A');
    expect(result.actionReportedStatus).toBe('REPORTED_SUCCESS');
    expect(result.verificationVerdict).toBe('PASS');
    expect(result.traceId).toBeDefined();

    // Verify trace is stored in registry and inspectable
    const traceInspect = await inspectTool.execute({ traceId: result.traceId }, ctx);
    expect(traceInspect.result.overallVerdict).toBe('PASS');
  });

  it('Scenario B: executes False Success and proves FAIL (Primary Demo)', async () => {
    const ctx = createMockContext();
    const result = await tool.execute({ scenarioId: 'SCENARIO_B' }, ctx);

    expect(result.status).toBe('success');
    expect(result.scenarioId).toBe('SCENARIO_B');
    // Action claimed success!
    expect(result.actionReportedStatus).toBe('REPORTED_SUCCESS');
    // But verified verdict is FAIL because ground truth was unchanged!
    expect(result.verificationVerdict).toBe('FAIL');
  });

  it('Scenario C: executes Wrong Target Mutation and returns FAIL', async () => {
    const ctx = createMockContext();
    const result = await tool.execute({ scenarioId: 'SCENARIO_C' }, ctx);

    expect(result.scenarioId).toBe('SCENARIO_C');
    expect(result.actionReportedStatus).toBe('REPORTED_SUCCESS');
    expect(result.verificationVerdict).toBe('FAIL');
  });

  it('Scenario D: executes Partial Update and returns FAIL', async () => {
    const ctx = createMockContext();
    const result = await tool.execute({ scenarioId: 'SCENARIO_D' }, ctx);

    expect(result.scenarioId).toBe('SCENARIO_D');
    expect(result.verificationVerdict).toBe('FAIL');
  });

  it('Scenario E: executes Missing Target and returns INCONCLUSIVE', async () => {
    const ctx = createMockContext();
    const result = await tool.execute({ scenarioId: 'SCENARIO_E' }, ctx);

    expect(result.scenarioId).toBe('SCENARIO_E');
    expect(result.verificationVerdict).toBe('INCONCLUSIVE');
  });

  it('Scenario F: executes Observation Unavailable and returns INCONCLUSIVE', async () => {
    const ctx = createMockContext();
    const result = await tool.execute({ scenarioId: 'SCENARIO_F' }, ctx);

    expect(result.scenarioId).toBe('SCENARIO_F');
    // Reader timeout produces INCONCLUSIVE, never false FAIL or false PASS
    expect(result.verificationVerdict).toBe('INCONCLUSIVE');
    expect(result.evidenceCount).toBe(0);
  });

  it('Scenario G: executes Tenant Isolation and returns PASS', async () => {
    const ctx = createMockContext();
    const result = await tool.execute({ scenarioId: 'SCENARIO_G' }, ctx);

    expect(result.scenarioId).toBe('SCENARIO_G');
    expect(result.verificationVerdict).toBe('PASS');
  });

  it('Scenario H: executes Multiple Required Conditions and returns FAIL (Tri-state dominance)', async () => {
    const ctx = createMockContext();
    const result = await tool.execute({ scenarioId: 'SCENARIO_H' }, ctx);

    expect(result.scenarioId).toBe('SCENARIO_H');
    expect(result.verificationVerdict).toBe('FAIL');
  });

  it('rejects unknown scenario IDs with an informative error message', async () => {
    const ctx = createMockContext();
    await expect(tool.execute({ scenarioId: 'SCENARIO_UNKNOWN' }, ctx)).rejects.toThrow(
      /Unknown scenario \[SCENARIO_UNKNOWN\]/
    );
  });

  it('handles case-insensitive scenario identifiers (e.g. scenario_a)', async () => {
    const ctx = createMockContext();
    const result = await tool.execute({ scenarioId: 'scenario_a' }, ctx);
    expect(result.verificationVerdict).toBe('PASS');
  });
});
