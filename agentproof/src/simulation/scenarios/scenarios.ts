/**
 * AgentProof Simulation — Pre-built Demonstration Scenarios
 * 
 * Factory functions to create Scenarios A through H covering:
 * - Scenario A: Genuine Success (PASS)
 * - Scenario B: False Success (FAIL - Primary Thesis)
 * - Scenario C: Wrong Target Mutation (FAIL / Unchanged Target)
 * - Scenario D: Partial Update (FAIL - Multi-attribute violation)
 * - Scenario E: Missing Target (INCONCLUSIVE / Resource Absent)
 * - Scenario F: Observation Unavailable (INCONCLUSIVE - Controlled Read Failure)
 * - Scenario G: Tenant Isolation (Strict Tenant Boundaries)
 * - Scenario H: Multiple Required Conditions (FAIL Dominance in Tri-State Aggregation)
 */

import {
  VerificationRequest,
  ResourceTarget,
} from '../../core/index.js';
import { SubscriptionRecord } from '../domain/subscription.js';
import { ScenarioDefinition } from './scenario-types.js';

const DEFAULT_TIMESTAMP = '2026-10-17T12:00:00.000Z';

export function createBaseSubscription(overrides?: Partial<SubscriptionRecord>): SubscriptionRecord {
  return {
    subscriptionId: 'sub-100',
    tenantId: 'tenant-alpha',
    customerId: 'cust-501',
    status: 'ACTIVE',
    plan: 'enterprise',
    maxSeats: 50,
    features: ['api_access', 'audit_logs'],
    updatedAt: DEFAULT_TIMESTAMP,
    revision: 1,
    ...overrides,
  };
}

/**
 * Scenario A: Genuine Success
 * Initial: sub-100 is ACTIVE
 * Action: Cancel sub-100 (GENUINE_SUCCESS)
 * Ground Truth: sub-100 becomes CANCELLED
 * Independent Observation: status is CANCELLED
 * Expected Verdict: PASS
 */
export function createScenarioA_GenuineSuccess(): ScenarioDefinition {
  const sub = createBaseSubscription();
  const target: ResourceTarget = {
    system: 'billing-system',
    resourceType: 'subscription',
    resourceId: sub.subscriptionId,
    tenantId: sub.tenantId,
  };

  const request: VerificationRequest = {
    schemaVersion: '1.0.0',
    requestId: 'req-scenario-a',
    timestamp: DEFAULT_TIMESTAMP,
    target,
    intent: {
      operation: 'cancel_subscription',
      summary: 'Cancel active enterprise subscription',
      expectedChanges: { status: 'CANCELLED' },
    },
    preconditions: [],
    postconditions: [
      {
        id: 'post-status-cancelled',
        description: 'Subscription status must be CANCELLED',
        path: 'status',
        operator: 'EQUALS',
        expectedValue: 'CANCELLED',
        enforcement: 'REQUIRED',
      },
    ],
    policy: {
      timeoutMs: 5000,
      requireIndependentSource: true,
      freshnessToleranceMs: 60000,
    },
  };

  return {
    id: 'SCENARIO_A',
    name: 'Genuine Success',
    description: 'Action mutates target subscription and independent observation confirms PASS.',
    initialSubscriptions: [sub],
    actionInvocation: {
      toolName: 'cancel_subscription',
      target,
      args: {
        operation: 'cancel_subscription',
        updates: { status: 'CANCELLED' },
      },
      failureInjection: {
        mode: 'GENUINE_SUCCESS',
      },
    },
    request,
  };
}

/**
 * Scenario B: False Success (Primary AgentProof Demonstration)
 * Initial: sub-100 is ACTIVE
 * Action: Claims cancellation succeeded (FALSE_SUCCESS)
 * Ground Truth: sub-100 remains ACTIVE
 * Independent Observation: status is ACTIVE
 * Expected Verdict: FAIL (Contradicted by reliable independent evidence)
 */
export function createScenarioB_FalseSuccess(): ScenarioDefinition {
  const sub = createBaseSubscription();
  const target: ResourceTarget = {
    system: 'billing-system',
    resourceType: 'subscription',
    resourceId: sub.subscriptionId,
    tenantId: sub.tenantId,
  };

  const request: VerificationRequest = {
    schemaVersion: '1.0.0',
    requestId: 'req-scenario-b',
    timestamp: DEFAULT_TIMESTAMP,
    target,
    intent: {
      operation: 'cancel_subscription',
      summary: 'Cancel active enterprise subscription',
      expectedChanges: { status: 'CANCELLED' },
    },
    preconditions: [],
    postconditions: [
      {
        id: 'post-status-cancelled',
        description: 'Subscription status must be CANCELLED',
        path: 'status',
        operator: 'EQUALS',
        expectedValue: 'CANCELLED',
        enforcement: 'REQUIRED',
      },
    ],
    policy: {
      timeoutMs: 5000,
      requireIndependentSource: true,
      freshnessToleranceMs: 60000,
    },
  };

  return {
    id: 'SCENARIO_B',
    name: 'False Success',
    description:
      'Action reports success without executing mutation; independent observation proves state unchanged and results in FAIL.',
    initialSubscriptions: [sub],
    actionInvocation: {
      toolName: 'cancel_subscription',
      target,
      args: {
        operation: 'cancel_subscription',
        updates: { status: 'CANCELLED' },
      },
      failureInjection: {
        mode: 'FALSE_SUCCESS',
      },
    },
    request,
  };
}

/**
 * Scenario C: Wrong Target Mutation
 * Initial: sub-100 is ACTIVE, sub-200 is ACTIVE
 * Action: Claims sub-100 cancelled, but mutates sub-200 instead (WRONG_TARGET)
 * Ground Truth: sub-100 is ACTIVE, sub-200 is CANCELLED
 * Independent Observation: target sub-100 is observed as ACTIVE
 * Expected Verdict: FAIL (Intended target condition was not satisfied)
 */
export function createScenarioC_WrongTarget(): ScenarioDefinition {
  const subA = createBaseSubscription({ subscriptionId: 'sub-100', status: 'ACTIVE' });
  const subB = createBaseSubscription({ subscriptionId: 'sub-200', status: 'ACTIVE' });

  const targetA: ResourceTarget = {
    system: 'billing-system',
    resourceType: 'subscription',
    resourceId: subA.subscriptionId,
    tenantId: subA.tenantId,
  };

  const targetB: ResourceTarget = {
    system: 'billing-system',
    resourceType: 'subscription',
    resourceId: subB.subscriptionId,
    tenantId: subB.tenantId,
  };

  const request: VerificationRequest = {
    schemaVersion: '1.0.0',
    requestId: 'req-scenario-c',
    timestamp: DEFAULT_TIMESTAMP,
    target: targetA,
    intent: {
      operation: 'cancel_subscription',
      summary: 'Cancel subscription A',
      expectedChanges: { status: 'CANCELLED' },
    },
    preconditions: [],
    postconditions: [
      {
        id: 'post-status-cancelled',
        description: 'Subscription A status must be CANCELLED',
        path: 'status',
        operator: 'EQUALS',
        expectedValue: 'CANCELLED',
        enforcement: 'REQUIRED',
      },
    ],
    policy: {
      timeoutMs: 5000,
      requireIndependentSource: true,
      freshnessToleranceMs: 60000,
    },
  };

  return {
    id: 'SCENARIO_C',
    name: 'Wrong Target Mutation',
    description: 'Action mutates unintended resource B; verifier observes intended resource A and yields FAIL.',
    initialSubscriptions: [subA, subB],
    actionInvocation: {
      toolName: 'cancel_subscription',
      target: targetA,
      args: {
        operation: 'cancel_subscription',
        updates: { status: 'CANCELLED' },
      },
      failureInjection: {
        mode: 'WRONG_TARGET',
        wrongTargetSubscriptionId: 'sub-200',
      },
    },
    request,
    additionalObservationTargets: [targetB],
  };
}

/**
 * Scenario D: Partial Update
 * Initial: sub-100 status is ACTIVE, plan is enterprise
 * Action: Requested status CANCELLED and plan downgraded to 'free' (PARTIAL_UPDATE: only plan updated)
 * Ground Truth: status is ACTIVE (unchanged), plan is 'free'
 * Independent Observation: status is ACTIVE, plan is 'free'
 * Expected Verdict: FAIL (Required status condition failed)
 */
export function createScenarioD_PartialUpdate(): ScenarioDefinition {
  const sub = createBaseSubscription({
    subscriptionId: 'sub-100',
    status: 'ACTIVE',
    plan: 'enterprise',
  });

  const target: ResourceTarget = {
    system: 'billing-system',
    resourceType: 'subscription',
    resourceId: sub.subscriptionId,
    tenantId: sub.tenantId,
  };

  const request: VerificationRequest = {
    schemaVersion: '1.0.0',
    requestId: 'req-scenario-d',
    timestamp: DEFAULT_TIMESTAMP,
    target,
    intent: {
      operation: 'downgrade_and_cancel',
      summary: 'Downgrade plan and cancel subscription',
      expectedChanges: { status: 'CANCELLED', plan: 'free' },
    },
    preconditions: [],
    postconditions: [
      {
        id: 'post-status-cancelled',
        description: 'Status must be CANCELLED',
        path: 'status',
        operator: 'EQUALS',
        expectedValue: 'CANCELLED',
        enforcement: 'REQUIRED',
      },
      {
        id: 'post-plan-free',
        description: 'Plan must be downgraded to free',
        path: 'plan',
        operator: 'EQUALS',
        expectedValue: 'free',
        enforcement: 'REQUIRED',
      },
    ],
    policy: {
      timeoutMs: 5000,
      requireIndependentSource: true,
      freshnessToleranceMs: 60000,
    },
  };

  return {
    id: 'SCENARIO_D',
    name: 'Partial Update',
    description: 'Action mutates plan but fails to cancel status; verifier rejects incomplete execution as FAIL.',
    initialSubscriptions: [sub],
    actionInvocation: {
      toolName: 'downgrade_and_cancel',
      target,
      args: {
        operation: 'downgrade_and_cancel',
        updates: { status: 'CANCELLED', plan: 'free' },
      },
      failureInjection: {
        mode: 'PARTIAL_UPDATE',
        partialFields: ['plan'], // status is deliberately omitted
      },
    },
    request,
  };
}

/**
 * Scenario E: Missing Target
 * Initial: No subscription with ID 'sub-missing' exists
 * Action: Tries to cancel 'sub-missing'
 * Ground Truth: Record not found
 * Independent Observation: NOT_FOUND, observedPayload is null
 * Postcondition: path: 'status', operator: 'EQUALS', expectedValue: 'CANCELLED'
 * Expected Verdict: INCONCLUSIVE (Attribute 'status' missing from null payload)
 */
export function createScenarioE_MissingTarget(): ScenarioDefinition {
  const target: ResourceTarget = {
    system: 'billing-system',
    resourceType: 'subscription',
    resourceId: 'sub-missing',
    tenantId: 'tenant-alpha',
  };

  const request: VerificationRequest = {
    schemaVersion: '1.0.0',
    requestId: 'req-scenario-e',
    timestamp: DEFAULT_TIMESTAMP,
    target,
    intent: {
      operation: 'cancel_subscription',
      summary: 'Cancel nonexistent subscription',
      expectedChanges: { status: 'CANCELLED' },
    },
    preconditions: [],
    postconditions: [
      {
        id: 'post-status-cancelled',
        description: 'Status must be CANCELLED',
        path: 'status',
        operator: 'EQUALS',
        expectedValue: 'CANCELLED',
        enforcement: 'REQUIRED',
      },
    ],
    policy: {
      timeoutMs: 5000,
      requireIndependentSource: true,
      freshnessToleranceMs: 60000,
    },
  };

  return {
    id: 'SCENARIO_E',
    name: 'Missing Target',
    description: 'Target resource does not exist in ground truth; verifier yields INCONCLUSIVE.',
    initialSubscriptions: [], // no subscriptions seeded
    actionInvocation: {
      toolName: 'cancel_subscription',
      target,
      args: {
        operation: 'cancel_subscription',
        updates: { status: 'CANCELLED' },
      },
      failureInjection: {
        mode: 'FALSE_SUCCESS', // reports success anyway
      },
    },
    request,
  };
}

/**
 * Scenario F: Observation Unavailable
 * Initial: sub-100 is ACTIVE
 * Action: Action executes
 * Observation: Reader fails with simulated datastore timeout
 * Evidence: No valid evidence produced
 * Expected Verdict: INCONCLUSIVE (INC_EVIDENCE_NOT_FOUND)
 */
export function createScenarioF_ObservationUnavailable(): ScenarioDefinition {
  const sub = createBaseSubscription();
  const target: ResourceTarget = {
    system: 'billing-system',
    resourceType: 'subscription',
    resourceId: sub.subscriptionId,
    tenantId: sub.tenantId,
  };

  const request: VerificationRequest = {
    schemaVersion: '1.0.0',
    requestId: 'req-scenario-f',
    timestamp: DEFAULT_TIMESTAMP,
    target,
    intent: {
      operation: 'cancel_subscription',
      summary: 'Cancel subscription under reader failure',
      expectedChanges: { status: 'CANCELLED' },
    },
    preconditions: [],
    postconditions: [
      {
        id: 'post-status-cancelled',
        description: 'Subscription status must be CANCELLED',
        path: 'status',
        operator: 'EQUALS',
        expectedValue: 'CANCELLED',
        enforcement: 'REQUIRED',
      },
    ],
    policy: {
      timeoutMs: 5000,
      requireIndependentSource: true,
      freshnessToleranceMs: 60000,
    },
  };

  return {
    id: 'SCENARIO_F',
    name: 'Observation Unavailable',
    description: 'Independent reader suffers connection timeout; verifier cleanly returns INCONCLUSIVE without false FAIL.',
    initialSubscriptions: [sub],
    actionInvocation: {
      toolName: 'cancel_subscription',
      target,
      args: {
        operation: 'cancel_subscription',
        updates: { status: 'CANCELLED' },
      },
      failureInjection: {
        mode: 'GENUINE_SUCCESS',
      },
    },
    request,
    simulatedObservationError: (t) =>
      t.resourceId === 'sub-100' ? 'Datastore connection timed out during read' : null,
  };
}

/**
 * Scenario G: Tenant Isolation
 * Initial: tenant-alpha has sub-100, tenant-beta has sub-200
 * Action: Request intended for tenant-alpha sub-100
 * Reader: Tenant boundaries strictly enforced; cross-tenant query returns null
 * Expected Verdict: Evaluated strictly within tenant context
 */
export function createScenarioG_TenantIsolation(): ScenarioDefinition {
  const subAlpha = createBaseSubscription({
    subscriptionId: 'sub-100',
    tenantId: 'tenant-alpha',
    status: 'ACTIVE',
  });
  const subBeta = createBaseSubscription({
    subscriptionId: 'sub-200',
    tenantId: 'tenant-beta',
    status: 'ACTIVE',
  });

  const targetAlpha: ResourceTarget = {
    system: 'billing-system',
    resourceType: 'subscription',
    resourceId: subAlpha.subscriptionId,
    tenantId: 'tenant-alpha',
  };

  const request: VerificationRequest = {
    schemaVersion: '1.0.0',
    requestId: 'req-scenario-g',
    timestamp: DEFAULT_TIMESTAMP,
    target: targetAlpha,
    intent: {
      operation: 'cancel_subscription',
      summary: 'Cancel tenant-alpha subscription',
      expectedChanges: { status: 'CANCELLED' },
    },
    preconditions: [],
    postconditions: [
      {
        id: 'post-status-cancelled',
        description: 'Tenant alpha subscription must be CANCELLED',
        path: 'status',
        operator: 'EQUALS',
        expectedValue: 'CANCELLED',
        enforcement: 'REQUIRED',
      },
    ],
    policy: {
      timeoutMs: 5000,
      requireIndependentSource: true,
      freshnessToleranceMs: 60000,
    },
  };

  return {
    id: 'SCENARIO_G',
    name: 'Tenant Isolation',
    description: 'Ensures operations and observations remain strictly isolated across tenant boundaries.',
    initialSubscriptions: [subAlpha, subBeta],
    actionInvocation: {
      toolName: 'cancel_subscription',
      target: targetAlpha,
      args: {
        operation: 'cancel_subscription',
        updates: { status: 'CANCELLED' },
      },
      failureInjection: {
        mode: 'GENUINE_SUCCESS',
      },
    },
    request,
  };
}

/**
 * Scenario H: Multiple Required Conditions (Tri-State Dominance)
 * Initial: sub-100 status ACTIVE, plan enterprise, maxSeats 50
 * Action: mutates status to CANCELLED, leaves plan as enterprise, maxSeats 50
 * Conditions:
 * 1. status == 'CANCELLED' (REQUIRED) -> PASS
 * 2. plan == 'starter' (REQUIRED) -> FAIL (still enterprise)
 * 3. maxSeats == 50 (REQUIRED) -> PASS
 * Expected Verdict: FAIL (A single required failure dominates passing conditions)
 */
export function createScenarioH_MultipleRequiredConditions(): ScenarioDefinition {
  const sub = createBaseSubscription({
    subscriptionId: 'sub-100',
    status: 'ACTIVE',
    plan: 'enterprise',
    maxSeats: 50,
  });

  const target: ResourceTarget = {
    system: 'billing-system',
    resourceType: 'subscription',
    resourceId: sub.subscriptionId,
    tenantId: sub.tenantId,
  };

  const request: VerificationRequest = {
    schemaVersion: '1.0.0',
    requestId: 'req-scenario-h',
    timestamp: DEFAULT_TIMESTAMP,
    target,
    intent: {
      operation: 'cancel_and_convert_plan',
      summary: 'Cancel subscription and convert plan to starter',
      expectedChanges: { status: 'CANCELLED', plan: 'starter' },
    },
    preconditions: [],
    postconditions: [
      {
        id: 'post-1-status',
        description: 'Status must be CANCELLED',
        path: 'status',
        operator: 'EQUALS',
        expectedValue: 'CANCELLED',
        enforcement: 'REQUIRED',
      },
      {
        id: 'post-2-plan',
        description: 'Plan must be starter',
        path: 'plan',
        operator: 'EQUALS',
        expectedValue: 'starter',
        enforcement: 'REQUIRED',
      },
      {
        id: 'post-3-seats',
        description: 'Seats must remain 50',
        path: 'maxSeats',
        operator: 'EQUALS',
        expectedValue: 50,
        enforcement: 'REQUIRED',
      },
    ],
    policy: {
      timeoutMs: 5000,
      requireIndependentSource: true,
      freshnessToleranceMs: 60000,
    },
  };

  return {
    id: 'SCENARIO_H',
    name: 'Multiple Required Conditions',
    description: 'Demonstrates Phase 2 FAIL > INCONCLUSIVE > PASS dominance rule across multiple postconditions.',
    initialSubscriptions: [sub],
    actionInvocation: {
      toolName: 'cancel_and_convert_plan',
      target,
      args: {
        operation: 'cancel_and_convert_plan',
        updates: { status: 'CANCELLED' }, // plan is not converted to starter
      },
      failureInjection: {
        mode: 'GENUINE_SUCCESS',
      },
    },
    request,
  };
}
