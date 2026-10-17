/**
 * AgentProof Simulation — Clock Abstraction
 * 
 * Provides deterministic time progression for repeatable test scenarios.
 */

export interface IClock {
  /**
   * Returns current time as an ISO-8601 string.
   */
  now(): string;

  /**
   * Returns current epoch milliseconds.
   */
  nowMs(): number;
}

export class DeterministicClock implements IClock {
  private currentMs: number;

  constructor(initialIsoOrMs: string | number = '2026-10-17T12:00:00.000Z') {
    this.currentMs = typeof initialIsoOrMs === 'string'
      ? new Date(initialIsoOrMs).getTime()
      : initialIsoOrMs;
  }

  public now(): string {
    return new Date(this.currentMs).toISOString();
  }

  public nowMs(): number {
    return this.currentMs;
  }

  public advance(ms: number): void {
    if (ms < 0) {
      throw new Error('Clock cannot travel backwards in time.');
    }
    this.currentMs += ms;
  }

  public set(isoOrMs: string | number): void {
    this.currentMs = typeof isoOrMs === 'string'
      ? new Date(isoOrMs).getTime()
      : isoOrMs;
  }
}

export class RealClock implements IClock {
  public now(): string {
    return new Date().toISOString();
  }

  public nowMs(): number {
    return Date.now();
  }
}
