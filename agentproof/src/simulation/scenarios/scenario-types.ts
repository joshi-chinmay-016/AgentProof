/**
 * AgentProof Simulation — Scenario Types
 * 
 * Defines specifications and execution outcomes for simulated verification scenarios.
 */

import {
  VerificationRequest,
  VerificationResult,
  VerificationTrace,
  Evidence,
  ActionRecord,
  ResourceTarget,
} from '../../core/index.js';
import { SubscriptionRecord } from '../domain/subscription.js';
import { ActionInvocation } from '../actions/mock-action-adapter.interface.js';
import { SimulatedErrorPredicate } from '../observation/in-memory-state-reader.js';

export interface ScenarioDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly initialSubscriptions: readonly SubscriptionRecord[];
  readonly actionInvocation: ActionInvocation;
  readonly request: VerificationRequest;
  readonly simulatedObservationError?: SimulatedErrorPredicate;
  readonly additionalObservationTargets?: readonly ResourceTarget[];
}

export interface ScenarioExecutionResult {
  readonly scenarioId: string;
  readonly initialRecords: readonly SubscriptionRecord[];
  readonly finalRecords: readonly SubscriptionRecord[];
  readonly actionInvocation: ActionInvocation;
  readonly actionRecord: ActionRecord;
  readonly evidence: readonly Evidence[];
  readonly verificationResult: VerificationResult;
  readonly trace: VerificationTrace;
}
