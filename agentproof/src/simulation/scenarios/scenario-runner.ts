/**
 * AgentProof Simulation — ScenarioRunner
 * 
 * Orchestrates end-to-end simulation scenarios:
 * 1. Seeds ground-truth repository
 * 2. Invokes MockActionAdapter with failure-injection configuration
 * 3. Independently observes ground truth via IStateReader
 * 4. Converts observations to Evidence
 * 5. Passes evidence and action record to Phase 2 VerificationEngine
 * 6. Produces immutable execution traces and results
 */

import * as crypto from 'node:crypto';
import {
  VerificationEngine,
  IVerifier,
  VerificationTrace,
} from '../../core/index.js';
import { InMemorySubscriptionRepository } from '../repositories/in-memory-subscription-repository.js';
import { ISubscriptionRepository } from '../repositories/subscription-repository.interface.js';
import { DeterministicClock, IClock } from '../domain/clock.js';
import { MockActionAdapter } from '../actions/mock-action-adapter.js';
import { IMockActionAdapter } from '../actions/mock-action-adapter.interface.js';
import { InMemoryStateReader } from '../observation/in-memory-state-reader.js';
import { EvidenceAdapter } from '../observation/evidence-adapter.js';
import { ScenarioDefinition, ScenarioExecutionResult } from './scenario-types.js';
import { ObservationRecord } from '../observation/state-reader.interface.js';
import { SubscriptionRecord } from '../domain/subscription.js';

export interface ScenarioRunnerComponents {
  readonly repository?: ISubscriptionRepository;
  readonly clock?: IClock;
  readonly verifier?: IVerifier;
  readonly actionAdapter?: IMockActionAdapter;
  readonly stateReader?: InMemoryStateReader;
  readonly evidenceAdapter?: EvidenceAdapter;
}

export class ScenarioRunner {
  private readonly repository: ISubscriptionRepository;
  private readonly clock: IClock;
  private readonly verifier: IVerifier;
  private readonly actionAdapter: IMockActionAdapter;
  private readonly stateReader: InMemoryStateReader;
  private readonly evidenceAdapter: EvidenceAdapter;

  constructor(components?: ScenarioRunnerComponents) {
    this.clock = components?.clock ?? new DeterministicClock();
    this.repository = components?.repository ?? new InMemorySubscriptionRepository(this.clock);
    this.verifier = components?.verifier ?? new VerificationEngine();
    this.actionAdapter =
      components?.actionAdapter ?? new MockActionAdapter(this.repository, this.clock);
    this.stateReader =
      components?.stateReader ?? new InMemoryStateReader(this.repository, this.clock);
    this.evidenceAdapter = components?.evidenceAdapter ?? new EvidenceAdapter();
  }

  /**
   * Executes a complete simulation scenario deterministically.
   */
  public async run(scenario: ScenarioDefinition): Promise<ScenarioExecutionResult> {
    // 1. Isolate environment & reset datastore
    this.repository.reset();
    this.stateReader.setSimulatedError(scenario.simulatedObservationError ?? null);

    // 2. Seed initial ground truth state
    this.repository.seed(scenario.initialSubscriptions);
    const initialRecords: SubscriptionRecord[] = scenario.initialSubscriptions.map((s) =>
      JSON.parse(JSON.stringify(s))
    );

    // 3. Execute requested tool action via mock adapter
    const actionRecord = await this.actionAdapter.execute(scenario.actionInvocation);

    // 4. Independently read target state from ground truth
    const observations: ObservationRecord[] = [];
    const primaryObs = await this.stateReader.readState(scenario.request.target);
    observations.push(primaryObs);

    // 5. Read any additional observation targets (e.g. wrong target inspection)
    if (scenario.additionalObservationTargets) {
      for (const additionalTarget of scenario.additionalObservationTargets) {
        const addObs = await this.stateReader.readState(additionalTarget);
        observations.push(addObs);
      }
    }

    // 6. Transform independent observations into Phase 2 Evidence
    const evidenceList = this.evidenceAdapter.toEvidenceList(observations);

    // 7. Verify using Phase 2 VerificationEngine
    const verificationResult = await this.verifier.verify(
      scenario.request,
      evidenceList,
      actionRecord
    );

    // 8. Capture audit trace
    let trace: VerificationTrace;
    if (
      this.verifier instanceof VerificationEngine &&
      typeof (this.verifier as any).createTrace === 'function'
    ) {
      trace = (this.verifier as VerificationEngine).createTrace(
        scenario.request,
        verificationResult,
        evidenceList,
        actionRecord
      );
    } else {
      trace = {
        traceId: crypto.randomUUID(),
        request: Object.freeze({ ...scenario.request }),
        action: Object.freeze({ ...actionRecord }),
        evidence: Object.freeze(evidenceList.map((e) => Object.freeze({ ...e }))),
        result: Object.freeze({ ...verificationResult }),
        recordedAt: this.clock.now(),
      };
    }

    // 9. Inspect final state of records
    const finalRecords: SubscriptionRecord[] = [];
    for (const init of initialRecords) {
      const current = this.repository.getById(init.tenantId, init.subscriptionId);
      if (current) {
        finalRecords.push(current);
      }
    }

    return {
      scenarioId: scenario.id,
      initialRecords: Object.freeze(initialRecords),
      finalRecords: Object.freeze(finalRecords),
      actionInvocation: scenario.actionInvocation,
      actionRecord,
      evidence: evidenceList,
      verificationResult,
      trace,
    };
  }

  public getRepository(): ISubscriptionRepository {
    return this.repository;
  }

  public getClock(): IClock {
    return this.clock;
  }

  public getStateReader(): InMemoryStateReader {
    return this.stateReader;
  }
}
