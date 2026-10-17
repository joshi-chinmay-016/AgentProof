import { describe, it, expect } from 'vitest';
import {
  ScenarioRunner,
  createScenarioA_GenuineSuccess,
  createScenarioB_FalseSuccess,
  DeterministicClock,
} from '../../src/simulation/index.js';
import { VerificationEngine } from '../../src/core/index.js';

describe('ScenarioRunner', () => {
  it('executes the complete pipeline using real VerificationEngine and returns structured results', async () => {
    const clock = new DeterministicClock('2026-10-17T12:00:00.000Z');
    const runner = new ScenarioRunner({ clock });

    const scenario = createScenarioA_GenuineSuccess();
    const result = await runner.run(scenario);

    expect(result.scenarioId).toBe('SCENARIO_A');
    expect(result.initialRecords).toHaveLength(1);
    expect(result.initialRecords[0].status).toBe('ACTIVE');

    // Final record in repository was mutated
    expect(result.finalRecords).toHaveLength(1);
    expect(result.finalRecords[0].status).toBe('CANCELLED');

    // Action record captures reported execution
    expect(result.actionRecord.executionStatus).toBe('REPORTED_SUCCESS');

    // Evidence was acquired from ground truth
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0].sourceKind).toBe('DIRECT_READ');

    // Verification engine produced PASS
    expect(result.verificationResult.overallVerdict).toBe('PASS');

    // Audit trace exists
    expect(result.trace.traceId).toBeDefined();
    expect(result.trace.request.requestId).toBe(scenario.request.requestId);
  });

  it('preserves datastore isolation between successive scenario runs', async () => {
    const runner = new ScenarioRunner();

    const scenarioA = createScenarioA_GenuineSuccess();
    const resultA = await runner.run(scenarioA);
    expect(resultA.verificationResult.overallVerdict).toBe('PASS');

    // Running scenario B should completely reset datastore and evaluate independently
    const scenarioB = createScenarioB_FalseSuccess();
    const resultB = await runner.run(scenarioB);

    expect(resultB.scenarioId).toBe('SCENARIO_B');
    // Scenario B must FAIL despite scenario A having passed
    expect(resultB.verificationResult.overallVerdict).toBe('FAIL');
    expect(resultB.finalRecords[0].status).toBe('ACTIVE');
  });

  it('does not mutate the caller-provided scenario definition or request', async () => {
    const runner = new ScenarioRunner();
    const scenario = createScenarioA_GenuineSuccess();
    const originalPostconditionsLength = scenario.request.postconditions.length;

    await runner.run(scenario);

    expect(scenario.request.postconditions.length).toBe(originalPostconditionsLength);
    expect(scenario.initialSubscriptions[0].status).toBe('ACTIVE');
  });
});
