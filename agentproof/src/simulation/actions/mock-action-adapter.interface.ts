/**
 * AgentProof Simulation — IMockActionAdapter
 * 
 * Formal interface for simulating an AI agent's tool execution layer.
 */

import { ActionRecord, ResourceTarget } from '../../core/index.js';
import { SubscriptionUpdateParams } from '../domain/subscription.js';
import { FailureInjectionConfig } from '../failure-injection/failure-mode.js';

export interface ActionInvocation {
  readonly actionId?: string;
  readonly toolName: string;
  readonly target: ResourceTarget;
  readonly args: {
    readonly operation: string;
    readonly updates?: SubscriptionUpdateParams;
    readonly [key: string]: unknown;
  };
  readonly agentId?: string;
  readonly failureInjection?: FailureInjectionConfig;
}

export interface IMockActionAdapter {
  /**
   * Executes a simulated action according to the specified failure injection rules
   * and returns a Phase 2 compliant ActionRecord capturing the claimed outcome.
   */
  execute(invocation: ActionInvocation): Promise<ActionRecord>;
}
