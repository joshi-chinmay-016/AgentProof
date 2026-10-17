/**
 * AgentProof Simulation — MockActionAdapter
 * 
 * Simulates an AI agent's tool invocation layer.
 * Executes mutations against the simulated subscription repository according to
 * explicit failure injection rules and produces a Phase 2 compliant ActionRecord.
 */

import * as crypto from 'node:crypto';
import {
  ActionRecord,
  ActionRecordSchema,
  ActionExecutionStatus,
} from '../../core/index.js';
import { ISubscriptionRepository } from '../repositories/subscription-repository.interface.js';
import { IClock, DeterministicClock } from '../domain/clock.js';
import { SubscriptionUpdateParams } from '../domain/subscription.js';
import { FailureMode, FailureInjectionConfigSchema } from '../failure-injection/failure-mode.js';
import { IMockActionAdapter, ActionInvocation } from './mock-action-adapter.interface.js';

export class MockActionAdapter implements IMockActionAdapter {
  private readonly repository: ISubscriptionRepository;
  private readonly clock: IClock;

  constructor(repository: ISubscriptionRepository, clock?: IClock) {
    this.repository = repository;
    this.clock = clock ?? new DeterministicClock();
  }

  public async execute(invocation: ActionInvocation): Promise<ActionRecord> {
    const actionId = invocation.actionId ?? `act-${crypto.randomUUID().slice(0, 8)}`;
    const invokedAt = this.clock.now();

    // Advance clock deterministically by 10ms to simulate execution duration
    if ('advance' in this.clock && typeof (this.clock as any).advance === 'function') {
      (this.clock as any).advance(10);
    }

    const tenantId = invocation.target.tenantId;
    if (!tenantId) {
      const completedAt = this.clock.now();
      return ActionRecordSchema.parse({
        actionId,
        toolName: invocation.toolName,
        target: invocation.target,
        sanitizedArgs: invocation.args,
        executionStatus: 'ERRORED' as ActionExecutionStatus,
        reportedResult: { error: 'Target tenantId must be specified for action execution' },
        invokedAt,
        completedAt,
        agentId: invocation.agentId,
      }) as ActionRecord;
    }

    // Default to GENUINE_SUCCESS if no failure injection specified
    const failureConfig = invocation.failureInjection ?? { mode: 'GENUINE_SUCCESS' };
    FailureInjectionConfigSchema.parse(failureConfig);

    const mode: FailureMode = failureConfig.mode;
    let executionStatus: ActionExecutionStatus = 'REPORTED_SUCCESS';
    let reportedResult: unknown = { status: 'success', message: 'Action executed successfully.' };

    try {
      switch (mode) {
        case 'GENUINE_SUCCESS': {
          const updates = this.resolveUpdates(invocation);
          this.repository.update(tenantId, invocation.target.resourceId, updates);
          reportedResult = {
            status: 'success',
            message: `Updated subscription [${invocation.target.resourceId}] successfully.`,
          };
          break;
        }

        case 'FALSE_SUCCESS': {
          // The action reports success, but NO mutation occurs on ground truth!
          reportedResult = {
            status: 'success',
            message: `Updated subscription [${invocation.target.resourceId}] successfully.`,
          };
          break;
        }

        case 'WRONG_TARGET': {
          const wrongTargetId = failureConfig.wrongTargetSubscriptionId;
          if (!wrongTargetId) {
            throw new Error('wrongTargetSubscriptionId is required for WRONG_TARGET mode.');
          }
          const updates = this.resolveUpdates(invocation);
          // Apply mutation to the wrong subscription in repository
          this.repository.update(tenantId, wrongTargetId, updates);
          // Claim success for the INTENDED target
          reportedResult = {
            status: 'success',
            message: `Updated subscription [${invocation.target.resourceId}] successfully.`,
          };
          break;
        }

        case 'PARTIAL_UPDATE': {
          const allUpdates = this.resolveUpdates(invocation);
          const partialKeys = failureConfig.partialFields ?? [];
          const partialUpdates: Record<string, unknown> = {};

          for (const key of partialKeys) {
            if (key in allUpdates) {
              partialUpdates[key] = (allUpdates as any)[key];
            }
          }

          // Apply only the partial subset of mutations
          this.repository.update(tenantId, invocation.target.resourceId, partialUpdates);
          reportedResult = {
            status: 'success',
            message: `Updated subscription [${invocation.target.resourceId}] successfully.`,
          };
          break;
        }

        case 'GENUINE_FAILURE': {
          executionStatus = 'REPORTED_FAILURE';
          reportedResult = {
            status: 'failed',
            error: failureConfig.failureMessage ?? 'Operation failed during execution.',
          };
          break;
        }

        default: {
          throw new Error(`Unsupported failure mode: ${mode}`);
        }
      }
    } catch (err: any) {
      executionStatus = 'ERRORED';
      reportedResult = {
        status: 'error',
        error: err.message ?? 'Unknown execution error',
      };
    }

    const completedAt = this.clock.now();

    const record: ActionRecord = {
      actionId,
      toolName: invocation.toolName,
      target: invocation.target,
      sanitizedArgs: invocation.args,
      executionStatus,
      reportedResult,
      invokedAt,
      completedAt,
      agentId: invocation.agentId,
    };

    return ActionRecordSchema.parse(record) as ActionRecord;
  }

  private resolveUpdates(invocation: ActionInvocation): SubscriptionUpdateParams {
    if (invocation.args.updates) {
      return invocation.args.updates;
    }

    // Default operation mapping if explicit updates object not provided
    if (invocation.args.operation === 'cancel_subscription') {
      return { status: 'CANCELLED' };
    }

    return {};
  }
}
