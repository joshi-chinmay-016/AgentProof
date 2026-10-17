/**
 * AgentProof Simulation — Phase 3 Demonstration Script
 * 
 * Demonstrates the core AgentProof thesis:
 * "An action reporting success is not proof that the intended state change occurred."
 * 
 * Runs Scenarios A through H through the real Phase 2 VerificationEngine
 * and prints an evidence-backed verification report.
 */

import { ScenarioRunner } from './scenarios/scenario-runner.js';
import {
  createScenarioA_GenuineSuccess,
  createScenarioB_FalseSuccess,
  createScenarioC_WrongTarget,
  createScenarioD_PartialUpdate,
  createScenarioE_MissingTarget,
  createScenarioF_ObservationUnavailable,
  createScenarioG_TenantIsolation,
  createScenarioH_MultipleRequiredConditions,
} from './scenarios/scenarios.js';

async function runDemo(): Promise<void> {
  const runner = new ScenarioRunner();

  const scenarios = [
    { factory: createScenarioA_GenuineSuccess, label: 'Scenario A: Genuine Success' },
    { factory: createScenarioB_FalseSuccess, label: 'Scenario B: False Success (Primary Demo)' },
    { factory: createScenarioC_WrongTarget, label: 'Scenario C: Wrong Target Mutation' },
    { factory: createScenarioD_PartialUpdate, label: 'Scenario D: Partial Update' },
    { factory: createScenarioE_MissingTarget, label: 'Scenario E: Missing Target' },
    { factory: createScenarioF_ObservationUnavailable, label: 'Scenario F: Observation Unavailable' },
    { factory: createScenarioG_TenantIsolation, label: 'Scenario G: Tenant Isolation' },
    { factory: createScenarioH_MultipleRequiredConditions, label: 'Scenario H: Multiple Required Conditions' },
  ];

  console.log('='.repeat(96));
  console.log(' AgentProof — Phase 3: Simulated Environment & Failure Injection Demonstration');
  console.log(' Thesis: "An action reporting success is not proof that the intended state change occurred."');
  console.log('='.repeat(96));

  const resultsTable: any[] = [];

  for (const { factory, label } of scenarios) {
    const scenario = factory();
    const result = await runner.run(scenario);

    const primaryTargetId = scenario.request.target.resourceId;
    const initialStatus = result.initialRecords.find(r => r.subscriptionId === primaryTargetId)?.status ?? 'ABSENT';
    const finalStatus = result.finalRecords.find(r => r.subscriptionId === primaryTargetId)?.status ?? 'ABSENT';
    const reportedAction = result.actionRecord.executionStatus;
    const verdict = result.verificationResult.overallVerdict;

    resultsTable.push({
      Scenario: scenario.id,
      Description: scenario.name,
      'Reported Action': reportedAction,
      'Initial Ground Truth': initialStatus,
      'Final Ground Truth': finalStatus,
      'Evidence Count': result.evidence.length,
      Verdict: verdict,
    });
  }

  console.table(resultsTable);
  console.log('='.repeat(96));
  console.log(' Demonstration finished successfully. All scenarios evaluated via Phase 2 VerificationEngine.');
  console.log('='.repeat(96));
}

// Run if directly executed
runDemo().catch((err) => {
  console.error('Demo execution failed:', err);
  process.exit(1);
});
