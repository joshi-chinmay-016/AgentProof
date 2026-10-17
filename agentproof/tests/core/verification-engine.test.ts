import { describe, it, expect } from 'vitest';
import {
  VerificationEngine,
  VerificationRequest,
  Evidence,
  ActionRecord,
  ReasonCodes,
  ValidationError,
} from '../../src/core/index.js';

describe('VerificationEngine — End-to-End Core Verification', () => {
  const engine = new VerificationEngine({
    verifierName: 'AgentProof-Core-Test',
    verifierVersion: '1.0.0',
  });

  const baseRequest: VerificationRequest = {
    schemaVersion: '1.0.0',
    requestId: 'req_001_sub_upgrade',
    timestamp: '2026-10-17T12:00:00.000Z',
    target: {
      system: 'billing_service',
      resourceType: 'subscription',
      resourceId: 'sub_c791',
      tenantId: 'tenant_enterprise',
    },
    intent: {
      operation: 'upgrade_subscription',
      summary: 'Upgrade plan from free to pro with 10 seats',
      expectedChanges: { tier: 'pro', max_seats: 10 },
    },
    preconditions: [],
    postconditions: [
      {
        id: 'post_tier_pro',
        description: 'Tier must be pro',
        path: 'tier',
        operator: 'EQUALS',
        expectedValue: 'pro',
        enforcement: 'REQUIRED',
      },
      {
        id: 'post_seats_10',
        description: 'Seats must be 10',
        path: 'max_seats',
        operator: 'EQUALS',
        expectedValue: 10,
        enforcement: 'REQUIRED',
      },
    ],
    policy: {
      timeoutMs: 5000,
      requireIndependentSource: true,
      freshnessToleranceMs: 60000,
    },
  };

  const validEvidence: Evidence[] = [
    {
      evidenceId: 'ev_snapshot_001',
      evidenceType: 'STATE_SNAPSHOT',
      sourceId: 'db_replica_reader',
      sourceKind: 'DIRECT_READ',
      target: {
        system: 'billing_service',
        resourceType: 'subscription',
        resourceId: 'sub_c791',
        tenantId: 'tenant_enterprise',
      },
      observedPayload: {
        subscription_id: 'sub_c791',
        tier: 'pro',
        max_seats: 10,
        status: 'active',
      },
      observedAt: '2026-10-17T12:00:02.000Z',
      freshnessMs: 120,
      integrityHash: 'sha256_mock_hash_abc123',
      limitations: [],
    },
  ];

  const actionRecord: ActionRecord = {
    actionId: 'act_update_sub_01',
    toolName: 'update_subscription',
    target: {
      system: 'billing_service',
      resourceType: 'subscription',
      resourceId: 'sub_c791',
      tenantId: 'tenant_enterprise',
    },
    sanitizedArgs: { tier: 'pro', max_seats: 10 },
    executionStatus: 'REPORTED_SUCCESS',
    reportedResult: { status: 'success', message: 'Subscription updated' },
    invokedAt: '2026-10-17T12:00:01.000Z',
    completedAt: '2026-10-17T12:00:02.000Z',
    agentId: 'billing_agent_v1',
  };

  it('19. A complete successful verification produces a valid result and trace representation', async () => {
    const result = await engine.verify(baseRequest, validEvidence, actionRecord);

    expect(result.schemaVersion).toBe('1.0.0');
    expect(result.requestId).toBe(baseRequest.requestId);
    expect(result.overallVerdict).toBe('PASS');
    expect(result.verifierIdentity.name).toBe('AgentProof-Core-Test');
    expect(result.conditionEvaluations.length).toBe(2);
    expect(result.conditionEvaluations.every((c) => c.verdict === 'PASS')).toBe(true);

    // Verify trace creation
    const trace = engine.createTrace(baseRequest, result, validEvidence, actionRecord);
    expect(trace.traceId).toBeDefined();
    expect(trace.request.requestId).toBe(baseRequest.requestId);
    expect(trace.result.overallVerdict).toBe('PASS');
    expect(trace.evidence.length).toBe(1);
    expect(trace.action?.actionId).toBe(actionRecord.actionId);
  });

  it('20. A failed postcondition produces the correct verdict and reason code', async () => {
    // Evidence shows tier is still 'free' (simulating silent failure / swallowed update)
    const falseSuccessEvidence: Evidence[] = [
      {
        ...validEvidence[0],
        evidenceId: 'ev_false_success',
        observedPayload: {
          subscription_id: 'sub_c791',
          tier: 'free',
          max_seats: 1,
        },
      },
    ];

    const result = await engine.verify(baseRequest, falseSuccessEvidence, actionRecord);

    expect(result.overallVerdict).toBe('FAIL');
    const failedEval = result.conditionEvaluations.find((c) => c.conditionId === 'post_tier_pro');
    expect(failedEval).toBeDefined();
    expect(failedEval?.verdict).toBe('FAIL');
    expect(failedEval?.reasonCode).toBe(ReasonCodes.FAIL_VALUE_MISMATCH);
    expect(result.summary).toContain('Verification FAILED');
  });

  it('21. Insufficient evidence produces INCONCLUSIVE', async () => {
    // Empty evidence array
    const result = await engine.verify(baseRequest, [], actionRecord);

    expect(result.overallVerdict).toBe('INCONCLUSIVE');
    expect(result.conditionEvaluations.every((c) => c.verdict === 'INCONCLUSIVE')).toBe(true);
    expect(result.conditionEvaluations[0].reasonCode).toBe(ReasonCodes.INC_EVIDENCE_NOT_FOUND);
  });

  it('22. Results contain references to the evidence actually used', async () => {
    const result = await engine.verify(baseRequest, validEvidence, actionRecord);

    expect(result.evidenceManifest.length).toBe(1);
    expect(result.evidenceManifest[0].evidenceId).toBe('ev_snapshot_001');
    expect(result.evidenceManifest[0].sourceId).toBe('db_replica_reader');
    expect(result.evidenceManifest[0].integrityHash).toBe('sha256_mock_hash_abc123');

    const evalTier = result.conditionEvaluations.find((c) => c.conditionId === 'post_tier_pro');
    expect(evalTier?.supportingEvidenceId).toBe('ev_snapshot_001');
  });

  it('23. Repeated evaluation of the same inputs produces the same substantive verdict and condition outcomes', async () => {
    const run1 = await engine.verify(baseRequest, validEvidence, actionRecord);
    const run2 = await engine.verify(baseRequest, validEvidence, actionRecord);

    expect(run1.overallVerdict).toBe(run2.overallVerdict);
    expect(run1.conditionEvaluations.length).toBe(run2.conditionEvaluations.length);
    for (let i = 0; i < run1.conditionEvaluations.length; i++) {
      expect(run1.conditionEvaluations[i].verdict).toBe(run2.conditionEvaluations[i].verdict);
      expect(run1.conditionEvaluations[i].reasonCode).toBe(run2.conditionEvaluations[i].reasonCode);
      expect(run1.conditionEvaluations[i].observed).toEqual(run2.conditionEvaluations[i].observed);
    }
  });

  it('24. The engine does not mutate its input request or evidence', async () => {
    const requestClone = JSON.parse(JSON.stringify(baseRequest));
    const evidenceClone = JSON.parse(JSON.stringify(validEvidence));
    const actionClone = JSON.parse(JSON.stringify(actionRecord));

    await engine.verify(baseRequest, validEvidence, actionRecord);

    expect(baseRequest).toEqual(requestClone);
    expect(validEvidence).toEqual(evidenceClone);
    expect(actionRecord).toEqual(actionClone);
  });

  it('Catches precondition violations before postconditions', async () => {
    const requestWithPrecondition: VerificationRequest = {
      ...baseRequest,
      preconditions: [
        {
          id: 'pre_tier_must_be_free',
          description: 'Tier must be free prior to upgrade',
          path: 'tier',
          operator: 'EQUALS',
          expectedValue: 'free',
          enforcement: 'REQUIRED',
        },
      ],
    };

    // State already has tier 'enterprise' -> precondition violated
    const enterpriseEvidence: Evidence[] = [
      {
        ...validEvidence[0],
        observedPayload: { tier: 'enterprise' },
      },
    ];

    const result = await engine.verify(requestWithPrecondition, enterpriseEvidence, actionRecord);

    expect(result.overallVerdict).toBe('FAIL');
    const preEval = result.conditionEvaluations.find((c) => c.conditionId === 'pre_tier_must_be_free');
    expect(preEval?.verdict).toBe('FAIL');
    expect(preEval?.reasonCode).toBe(ReasonCodes.FAIL_PRECONDITION_VIOLATED);
  });

  it('Rejects malformed input requests with ValidationError', async () => {
    const invalidReq = {
      ...baseRequest,
      requestId: '', // invalid
    };

    await expect(engine.verify(invalidReq as any, validEvidence)).rejects.toThrow(ValidationError);
  });
});
