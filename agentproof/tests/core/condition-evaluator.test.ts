import { describe, it, expect } from 'vitest';
import {
  ConditionEvaluator,
  ReasonCodes,
  ResourceTarget,
  Evidence,
  ActionRecord,
  ConditionSpec,
} from '../../src/core/index.js';

describe('ConditionEvaluator — Deterministic Rule Evaluation', () => {
  const evaluator = new ConditionEvaluator();

  const target: ResourceTarget = {
    system: 'billing_service',
    resourceType: 'subscription',
    resourceId: 'sub_c791',
  };

  const createEvidence = (payload: unknown, observedAt = new Date().toISOString(), overrides: Partial<Evidence> = {}): Evidence => ({
    evidenceId: 'ev_001',
    evidenceType: 'STATE_SNAPSHOT',
    sourceId: 'db_replica_reader',
    sourceKind: 'DIRECT_READ',
    target,
    observedPayload: payload,
    observedAt,
    freshnessMs: 50,
    integrityHash: 'sha256_mock_hash_123',
    limitations: [],
    ...overrides,
  });

  const createAction = (invokedAt = new Date().toISOString()): ActionRecord => ({
    actionId: 'act_001',
    toolName: 'update_subscription',
    target,
    sanitizedArgs: { tier: 'pro' },
    executionStatus: 'REPORTED_SUCCESS',
    reportedResult: { status: 'success', message: 'Operation reported complete' },
    invokedAt,
    completedAt: new Date().toISOString(),
  });

  it('5. A matching observed value satisfies an equality condition', () => {
    const condition: ConditionSpec = {
      id: 'cond_tier_pro',
      description: 'Tier must be pro',
      path: 'tier',
      operator: 'EQUALS',
      expectedValue: 'pro',
      enforcement: 'REQUIRED',
    };

    const evidence = [createEvidence({ tier: 'pro', max_seats: 10 })];
    const result = evaluator.evaluateCondition(condition, target, evidence);

    expect(result.verdict).toBe('PASS');
    expect(result.reasonCode).toBe(ReasonCodes.PASS_ALL_CONDITIONS_VERIFIED);
    expect(result.observed).toBe('pro');
    expect(result.supportingEvidenceId).toBe('ev_001');
  });

  it('6. A different observed value violates an equality condition', () => {
    const condition: ConditionSpec = {
      id: 'cond_tier_pro',
      description: 'Tier must be pro',
      path: 'tier',
      operator: 'EQUALS',
      expectedValue: 'pro',
      enforcement: 'REQUIRED',
    };

    // Database still contains 'free' (e.g. false success scenario)
    const evidence = [createEvidence({ tier: 'free', max_seats: 1 })];
    const result = evaluator.evaluateCondition(condition, target, evidence);

    expect(result.verdict).toBe('FAIL');
    expect(result.reasonCode).toBe(ReasonCodes.FAIL_VALUE_MISMATCH);
    expect(result.observed).toBe('free');
  });

  it('7. Missing evidence produces the appropriate inconclusive outcome', () => {
    const condition: ConditionSpec = {
      id: 'cond_tier_pro',
      description: 'Tier must be pro',
      path: 'tier',
      operator: 'EQUALS',
      expectedValue: 'pro',
      enforcement: 'REQUIRED',
    };

    const result = evaluator.evaluateCondition(condition, target, []);

    expect(result.verdict).toBe('INCONCLUSIVE');
    expect(result.reasonCode).toBe(ReasonCodes.INC_EVIDENCE_NOT_FOUND);
  });

  it('8. Evidence for an unrelated request or resource cannot satisfy the condition', () => {
    const condition: ConditionSpec = {
      id: 'cond_tier_pro',
      description: 'Tier must be pro',
      path: 'tier',
      operator: 'EQUALS',
      expectedValue: 'pro',
      enforcement: 'REQUIRED',
    };

    // Unrelated resource target (different ID)
    const unrelatedEvidence = [
      createEvidence({ tier: 'pro' }, new Date().toISOString(), {
        evidenceId: 'ev_unrelated',
        target: {
          system: 'billing_service',
          resourceType: 'subscription',
          resourceId: 'sub_OTHER_RESOURCE_999',
        },
      }),
    ];

    const result = evaluator.evaluateCondition(condition, target, unrelatedEvidence);

    expect(result.verdict).toBe('INCONCLUSIVE');
    expect(result.reasonCode).toBe(ReasonCodes.INC_EVIDENCE_NOT_FOUND);
  });

  it('9. Stale evidence is handled according to specified rules', () => {
    const condition: ConditionSpec = {
      id: 'cond_tier_pro',
      description: 'Tier must be pro',
      path: 'tier',
      operator: 'EQUALS',
      expectedValue: 'pro',
      enforcement: 'REQUIRED',
    };

    const actionTime = new Date('2026-10-17T12:00:00.000Z');
    const staleTime = new Date('2026-10-17T11:58:00.000Z').toISOString(); // 2 minutes older

    const action = createAction(actionTime.toISOString());
    // Tolerance is 60000ms (1 min), so 2 minutes older is stale
    const evidence = [createEvidence({ tier: 'pro' }, staleTime)];

    const result = evaluator.evaluateCondition(condition, target, evidence, action, 60000);

    expect(result.verdict).toBe('INCONCLUSIVE');
    expect(result.reasonCode).toBe(ReasonCodes.INC_STALE_EVIDENCE);
  });

  it('10. Conflicting observations are handled according to specified rules', () => {
    const condition: ConditionSpec = {
      id: 'cond_tier_pro',
      description: 'Tier must be pro',
      path: 'tier',
      operator: 'EQUALS',
      expectedValue: 'pro',
      enforcement: 'REQUIRED',
    };

    // Two replicas return contradictory state
    const evidenceReplicaA = createEvidence({ tier: 'pro' }, new Date().toISOString(), {
      evidenceId: 'ev_replica_a',
      sourceId: 'replica_a',
    });
    const evidenceReplicaB = createEvidence({ tier: 'free' }, new Date().toISOString(), {
      evidenceId: 'ev_replica_b',
      sourceId: 'replica_b',
    });

    const result = evaluator.evaluateCondition(condition, target, [
      evidenceReplicaA,
      evidenceReplicaB,
    ]);

    expect(result.verdict).toBe('INCONCLUSIVE');
    expect(result.reasonCode).toBe(ReasonCodes.INC_CONFLICTING_EVIDENCE);
  });

  it('11. Unsupported predicates cannot accidentally pass', () => {
    const condition: ConditionSpec = {
      id: 'cond_unsupported',
      description: 'Test invalid operator',
      path: 'tier',
      operator: 'NON_EXISTENT_OPERATOR' as any,
      expectedValue: 'pro',
      enforcement: 'REQUIRED',
    };

    const evidence = [createEvidence({ tier: 'pro' })];
    const result = evaluator.evaluateCondition(condition, target, evidence);

    expect(result.verdict).toBe('INCONCLUSIVE');
    expect(result.reasonCode).toBe(ReasonCodes.INC_UNSUPPORTED_PREDICATE);
  });

  it("12. An agent's own success claim cannot substitute for independent evidence", () => {
    const condition: ConditionSpec = {
      id: 'cond_tier_pro',
      description: 'Tier must be pro',
      path: 'tier',
      operator: 'EQUALS',
      expectedValue: 'pro',
      enforcement: 'REQUIRED',
    };

    // Action claims glowing success, but NO evidence exists
    const action = createAction();
    expect(action.executionStatus).toBe('REPORTED_SUCCESS');

    const result = evaluator.evaluateCondition(condition, target, [], action);

    // Must be INCONCLUSIVE, NEVER PASS
    expect(result.verdict).toBe('INCONCLUSIVE');
    expect(result.reasonCode).toBe(ReasonCodes.INC_EVIDENCE_NOT_FOUND);
  });

  it('Evaluates numeric comparisons (GREATER_THAN and LESS_THAN)', () => {
    const condGT: ConditionSpec = {
      id: 'cond_seats_gt',
      description: 'Seats > 5',
      path: 'max_seats',
      operator: 'GREATER_THAN',
      expectedValue: 5,
      enforcement: 'REQUIRED',
    };

    const passEv = [createEvidence({ max_seats: 10 })];
    expect(evaluator.evaluateCondition(condGT, target, passEv).verdict).toBe('PASS');

    const failEv = [createEvidence({ max_seats: 5 })];
    expect(evaluator.evaluateCondition(condGT, target, failEv).verdict).toBe('FAIL');

    const condLT: ConditionSpec = {
      id: 'cond_seats_lt',
      description: 'Seats < 20',
      path: 'max_seats',
      operator: 'LESS_THAN',
      expectedValue: 20,
      enforcement: 'REQUIRED',
    };
    expect(evaluator.evaluateCondition(condLT, target, passEv).verdict).toBe('PASS');
  });

  it('Evaluates CONTAINS on strings and arrays', () => {
    const condStr: ConditionSpec = {
      id: 'cond_str',
      description: 'Features contains analytics',
      path: 'features',
      operator: 'CONTAINS',
      expectedValue: 'analytics',
      enforcement: 'REQUIRED',
    };

    expect(evaluator.evaluateCondition(condStr, target, [createEvidence({ features: ['reporting', 'analytics'] })]).verdict).toBe('PASS');
    expect(evaluator.evaluateCondition(condStr, target, [createEvidence({ features: ['reporting', 'audit'] })]).verdict).toBe('FAIL');
    expect(evaluator.evaluateCondition(condStr, target, [createEvidence({ features: 'analytics_and_insights' })]).verdict).toBe('PASS');
  });

  it('Evaluates EXISTS and DOES_NOT_EXIST', () => {
    const condExists: ConditionSpec = {
      id: 'cond_ex',
      description: 'Cancel date does not exist',
      path: 'canceled_at',
      operator: 'DOES_NOT_EXIST',
      enforcement: 'REQUIRED',
    };

    expect(evaluator.evaluateCondition(condExists, target, [createEvidence({ tier: 'pro' })]).verdict).toBe('PASS');
    expect(evaluator.evaluateCondition(condExists, target, [createEvidence({ canceled_at: '2026-10-17' })]).verdict).toBe('FAIL');
  });

  it('Safely extracts deeply nested paths', () => {
    const payload = {
      customer: {
        account: {
          tier: 'enterprise',
          limits: { seats: 50 },
        },
      },
    };

    expect(evaluator.resolvePath(payload, 'customer.account.tier')).toBe('enterprise');
    expect(evaluator.resolvePath(payload, 'customer.account.limits.seats')).toBe(50);
    expect(evaluator.resolvePath(payload, 'customer.non_existent.path')).toBeUndefined();
    expect(evaluator.resolvePath(null, 'tier')).toBeUndefined();
  });
});
