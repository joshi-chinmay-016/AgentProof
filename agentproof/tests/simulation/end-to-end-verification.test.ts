import { describe, it, expect } from 'vitest';
import {
  ScenarioRunner,
  createScenarioA_GenuineSuccess,
  createScenarioB_FalseSuccess,
  createScenarioC_WrongTarget,
  createScenarioD_PartialUpdate,
  createScenarioE_MissingTarget,
  createScenarioF_ObservationUnavailable,
  createScenarioG_TenantIsolation,
  createScenarioH_MultipleRequiredConditions,
  DeterministicClock,
} from '../../src/simulation/index.js';
import { ReasonCodes } from '../../src/core/index.js';

describe('End-to-End Verification Scenarios (Scenarios A through H)', () => {
  it('Scenario A: Genuine Success -> PASS', async () => {
    const runner = new ScenarioRunner();
    const result = await runner.run(createScenarioA_GenuineSuccess());

    // 1. Initial ground-truth state
    expect(result.initialRecords[0].status).toBe('ACTIVE');

    // 2. Action reported outcome
    expect(result.actionRecord.executionStatus).toBe('REPORTED_SUCCESS');

    // 3. Actual final ground-truth state
    expect(result.finalRecords[0].status).toBe('CANCELLED');

    // 4. Evidence provenance
    expect(result.evidence).toHaveLength(1);
    expect(result.evidence[0].sourceKind).toBe('DIRECT_READ');
    expect(result.evidence[0].target.resourceId).toBe('sub-100');

    // 5. Final verdict & 6. Reason code
    expect(result.verificationResult.overallVerdict).toBe('PASS');
    expect(result.verificationResult.conditionEvaluations[0].reasonCode).toBe(
      ReasonCodes.PASS_ALL_CONDITIONS_VERIFIED
    );
  });

  it('Scenario B: False Success -> FAIL (Primary AgentProof Demonstration)', async () => {
    const runner = new ScenarioRunner();
    const result = await runner.run(createScenarioB_FalseSuccess());

    // 1. Initial ground truth: ACTIVE
    expect(result.initialRecords[0].status).toBe('ACTIVE');

    // 2. Action claims SUCCESS
    expect(result.actionRecord.executionStatus).toBe('REPORTED_SUCCESS');

    // 3. Actual final ground truth is UNCHANGED (ACTIVE)
    expect(result.finalRecords[0].status).toBe('ACTIVE');

    // 4. Evidence provenance reflects ground truth
    expect(result.evidence[0].target.resourceId).toBe('sub-100');
    expect((result.evidence[0].observedPayload as any).status).toBe('ACTIVE');

    // 5. Final verdict is FAIL (contradicted by reliable independent evidence!)
    expect(result.verificationResult.overallVerdict).toBe('FAIL');
    expect(result.verificationResult.conditionEvaluations[0].verdict).toBe('FAIL');
    expect(result.verificationResult.conditionEvaluations[0].reasonCode).toBe(
      ReasonCodes.FAIL_VALUE_MISMATCH
    );
  });

  it('Scenario C: Wrong Target Mutation -> FAIL for intended target', async () => {
    const runner = new ScenarioRunner();
    const result = await runner.run(createScenarioC_WrongTarget());

    // Action claimed success for sub-100
    expect(result.actionRecord.executionStatus).toBe('REPORTED_SUCCESS');
    expect(result.actionRecord.target.resourceId).toBe('sub-100');

    // In repository: sub-100 was NOT cancelled; sub-200 WAS cancelled
    const sub100Final = result.finalRecords.find((r) => r.subscriptionId === 'sub-100');
    const sub200Final = result.finalRecords.find((r) => r.subscriptionId === 'sub-200');

    expect(sub100Final?.status).toBe('ACTIVE');
    expect(sub200Final?.status).toBe('CANCELLED');

    // Verifier evaluates the intended target sub-100, which failed cancellation
    expect(result.verificationResult.overallVerdict).toBe('FAIL');
    expect(result.verificationResult.conditionEvaluations[0].verdict).toBe('FAIL');
    expect(result.verificationResult.conditionEvaluations[0].reasonCode).toBe(
      ReasonCodes.FAIL_VALUE_MISMATCH
    );
  });

  it('Scenario D: Partial Update -> FAIL when a required postcondition is violated', async () => {
    const runner = new ScenarioRunner();
    const result = await runner.run(createScenarioD_PartialUpdate());

    // Action claimed success
    expect(result.actionRecord.executionStatus).toBe('REPORTED_SUCCESS');

    // In repository: plan updated to free, but status remained ACTIVE
    expect(result.finalRecords[0].plan).toBe('free');
    expect(result.finalRecords[0].status).toBe('ACTIVE');

    // Verification result: condition 1 (status == CANCELLED) FAIL, condition 2 (plan == free) PASS
    const evals = result.verificationResult.conditionEvaluations;
    expect(evals[0].verdict).toBe('FAIL'); // status check
    expect(evals[1].verdict).toBe('PASS'); // plan check

    // Aggregated verdict is FAIL
    expect(result.verificationResult.overallVerdict).toBe('FAIL');
  });

  it('Scenario E: Missing Target -> INCONCLUSIVE (Target record absent)', async () => {
    const runner = new ScenarioRunner();
    const result = await runner.run(createScenarioE_MissingTarget());

    // Action claimed success for nonexistent subscription
    expect(result.actionRecord.executionStatus).toBe('REPORTED_SUCCESS');

    // Evidence observes payload as null
    expect(result.evidence[0].observedPayload).toBeNull();
    expect(result.evidence[0].limitations).toContain('RESOURCE_NOT_FOUND_IN_SYSTEM_OF_RECORD');

    // Verifier evaluates 'status' path on null payload -> INCONCLUSIVE (INC_MISSING_ATTRIBUTES)
    expect(result.verificationResult.overallVerdict).toBe('INCONCLUSIVE');
    expect(result.verificationResult.conditionEvaluations[0].reasonCode).toBe(
      ReasonCodes.INC_MISSING_ATTRIBUTES
    );
  });

  it('Scenario F: Observation Unavailable -> INCONCLUSIVE (Reader failure does not yield false FAIL)', async () => {
    const runner = new ScenarioRunner();
    const result = await runner.run(createScenarioF_ObservationUnavailable());

    // Action executed genuinely
    expect(result.actionRecord.executionStatus).toBe('REPORTED_SUCCESS');

    // State reader failed; no evidence could be gathered
    expect(result.evidence).toHaveLength(0);

    // Verification must be INCONCLUSIVE, NOT a false FAIL or false PASS!
    expect(result.verificationResult.overallVerdict).toBe('INCONCLUSIVE');
    expect(result.verificationResult.conditionEvaluations[0].reasonCode).toBe(
      ReasonCodes.INC_EVIDENCE_NOT_FOUND
    );
  });

  it('Scenario G: Tenant Isolation -> Strictly bounded by tenant', async () => {
    const runner = new ScenarioRunner();
    const result = await runner.run(createScenarioG_TenantIsolation());

    // Action mutates tenant-alpha record
    expect(result.verificationResult.overallVerdict).toBe('PASS');

    // Tenant-beta record is completely unaffected
    const betaFinal = runner.getRepository().getById('tenant-beta', 'sub-200');
    expect(betaFinal?.status).toBe('ACTIVE');
    expect(betaFinal?.revision).toBe(1);
  });

  it('Scenario H: Multiple Required Conditions -> FAIL dominance rule', async () => {
    const runner = new ScenarioRunner();
    const result = await runner.run(createScenarioH_MultipleRequiredConditions());

    // Conditions:
    // 1. status == 'CANCELLED' -> PASS
    // 2. plan == 'starter' -> FAIL (still enterprise)
    // 3. maxSeats == 50 -> PASS
    const evals = result.verificationResult.conditionEvaluations;
    expect(evals[0].verdict).toBe('PASS');
    expect(evals[1].verdict).toBe('FAIL');
    expect(evals[2].verdict).toBe('PASS');

    // Overall verdict is FAIL because FAIL dominates PASS
    expect(result.verificationResult.overallVerdict).toBe('FAIL');
  });

  it('Determinism test: repeated runs with identical inputs produce identical hashes and verdicts', async () => {
    const clock = new DeterministicClock('2026-10-17T12:00:00.000Z');
    const runner1 = new ScenarioRunner({ clock: new DeterministicClock('2026-10-17T12:00:00.000Z') });
    const runner2 = new ScenarioRunner({ clock: new DeterministicClock('2026-10-17T12:00:00.000Z') });

    const result1 = await runner1.run(createScenarioB_FalseSuccess());
    const result2 = await runner2.run(createScenarioB_FalseSuccess());

    expect(result1.verificationResult.overallVerdict).toBe(result2.verificationResult.overallVerdict);
    expect(result1.evidence[0].integrityHash).toBe(result2.evidence[0].integrityHash);
    expect(result1.actionRecord.invokedAt).toBe(result2.actionRecord.invokedAt);
  });
});
