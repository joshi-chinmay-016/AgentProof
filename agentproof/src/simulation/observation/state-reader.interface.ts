/**
 * AgentProof Simulation — IStateReader & Observation Contracts
 * 
 * Formal interface and observation types for reading ground-truth simulated state
 * completely independently of the agent's action execution outcome.
 */

import { ResourceTarget } from '../../core/index.js';
import { SubscriptionRecord } from '../domain/subscription.js';

export type ObservationStatus = 'FOUND' | 'NOT_FOUND' | 'READ_ERROR';

export interface ObservationRecord {
  readonly status: ObservationStatus;
  readonly target: ResourceTarget;
  readonly observedAt: string;
  readonly record: SubscriptionRecord | null;
  readonly errorMessage?: string;
  readonly readerIdentity: string;
}

export interface IStateReader {
  /**
   * Independently reads the actual current state of the target resource from ground truth.
   * Never infers outcome from the action claims.
   */
  readState(target: ResourceTarget): Promise<ObservationRecord>;
}
