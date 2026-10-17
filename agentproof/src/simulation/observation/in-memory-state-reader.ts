/**
 * AgentProof Simulation — InMemoryStateReader
 * 
 * Independent state reading adapter that queries the simulated subscription repository.
 * Operates without knowledge or trust of any action adapter's reported outcome.
 */

import { ResourceTarget } from '../../core/index.js';
import { ISubscriptionRepository } from '../repositories/subscription-repository.interface.js';
import { IClock, DeterministicClock } from '../domain/clock.js';
import { IStateReader, ObservationRecord } from './state-reader.interface.js';

export type SimulatedErrorPredicate = (target: ResourceTarget) => string | null;

export class InMemoryStateReader implements IStateReader {
  private readonly repository: ISubscriptionRepository;
  private readonly clock: IClock;
  private readonly readerIdentity: string;
  private simulatedErrorPredicate: SimulatedErrorPredicate | null = null;

  constructor(
    repository: ISubscriptionRepository,
    clock?: IClock,
    readerIdentity: string = 'simulated-subscription-reader'
  ) {
    this.repository = repository;
    this.clock = clock ?? new DeterministicClock();
    this.readerIdentity = readerIdentity;
  }

  /**
   * Configures a predicate to simulate controlled observation failure.
   * If the predicate returns a non-null string, readState will return a READ_ERROR.
   */
  public setSimulatedError(predicate: SimulatedErrorPredicate | null): void {
    this.simulatedErrorPredicate = predicate;
  }

  public async readState(target: ResourceTarget): Promise<ObservationRecord> {
    const observedAt = this.clock.now();

    // 1. Check for simulated observation failure (e.g. datastore unreachable, timeout)
    if (this.simulatedErrorPredicate) {
      const simulatedErrMsg = this.simulatedErrorPredicate(target);
      if (simulatedErrMsg !== null) {
        return {
          status: 'READ_ERROR',
          target,
          observedAt,
          record: null,
          errorMessage: simulatedErrMsg,
          readerIdentity: this.readerIdentity,
        };
      }
    }

    // 2. Validate tenant context
    if (!target.tenantId) {
      return {
        status: 'READ_ERROR',
        target,
        observedAt,
        record: null,
        errorMessage: 'Cannot read state: target does not specify a tenantId.',
        readerIdentity: this.readerIdentity,
      };
    }

    // 3. Query the repository directly for ground truth
    try {
      const record = this.repository.getById(target.tenantId, target.resourceId);

      if (record === null) {
        return {
          status: 'NOT_FOUND',
          target,
          observedAt,
          record: null,
          readerIdentity: this.readerIdentity,
        };
      }

      return {
        status: 'FOUND',
        target,
        observedAt,
        record,
        readerIdentity: this.readerIdentity,
      };
    } catch (err: any) {
      return {
        status: 'READ_ERROR',
        target,
        observedAt,
        record: null,
        errorMessage: err.message ?? 'Unknown datastore read error',
        readerIdentity: this.readerIdentity,
      };
    }
  }
}
