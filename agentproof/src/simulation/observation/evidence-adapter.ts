/**
 * AgentProof Simulation — EvidenceAdapter
 * 
 * Converts independent state observations into Phase 2 compliant Evidence objects.
 * Computes deterministic SHA-256 payload integrity hashes and enforces strict provenance.
 */

import * as crypto from 'node:crypto';
import {
  Evidence,
  EvidenceSchema,
  EvidenceType,
  SourceKind,
} from '../../core/index.js';
import { ObservationRecord } from './state-reader.interface.js';

export interface EvidenceAdapterOptions {
  readonly defaultSourceId?: string;
  readonly defaultSourceKind?: SourceKind;
  readonly defaultEvidenceType?: EvidenceType;
}

export class EvidenceAdapter {
  private readonly defaultSourceId: string;
  private readonly defaultSourceKind: SourceKind;
  private readonly defaultEvidenceType: EvidenceType;

  constructor(options?: EvidenceAdapterOptions) {
    this.defaultSourceId = options?.defaultSourceId ?? 'simulated-subscription-db';
    this.defaultSourceKind = options?.defaultSourceKind ?? 'DIRECT_READ';
    this.defaultEvidenceType = options?.defaultEvidenceType ?? 'STATE_SNAPSHOT';
  }

  /**
   * Converts a single ObservationRecord into a validated Evidence object.
   * Returns null if the observation was a READ_ERROR to avoid fabricating evidence.
   */
  public toEvidence(
    observation: ObservationRecord,
    options?: {
      readonly evidenceId?: string;
      readonly freshnessMs?: number;
    }
  ): Evidence | null {
    // Under observation failure, never synthesize or fabricate evidence
    if (observation.status === 'READ_ERROR') {
      return null;
    }

    const evidenceId = options?.evidenceId ?? `ev-${crypto.randomUUID().slice(0, 8)}`;
    const sourceId = observation.readerIdentity || this.defaultSourceId;
    const sourceKind = this.defaultSourceKind;
    const evidenceType = this.defaultEvidenceType;

    // For FOUND: the record snapshot
    // For NOT_FOUND: null, representing confirmed absence of the record
    const observedPayload = observation.record;

    const integrityHash = this.computePayloadHash(observedPayload);

    const limitations: string[] = [];
    if (observation.status === 'NOT_FOUND') {
      limitations.push('RESOURCE_NOT_FOUND_IN_SYSTEM_OF_RECORD');
    }

    const evidence: Evidence = {
      evidenceId,
      evidenceType,
      sourceId,
      sourceKind,
      target: observation.target,
      observedPayload,
      observedAt: observation.observedAt,
      freshnessMs: options?.freshnessMs ?? 0,
      integrityHash,
      limitations,
    };

    return EvidenceSchema.parse(evidence) as Evidence;
  }

  /**
   * Converts a list of ObservationRecords into Evidence items, filtering out observation failures.
   */
  public toEvidenceList(observations: readonly ObservationRecord[]): readonly Evidence[] {
    const list: Evidence[] = [];
    for (const obs of observations) {
      const ev = this.toEvidence(obs);
      if (ev !== null) {
        list.push(ev);
      }
    }
    return Object.freeze(list);
  }

  /**
   * Computes a canonical, deterministic SHA-256 hash of any JSON-serializable payload.
   * Key order independent.
   */
  public computePayloadHash(payload: unknown): string {
    const canonicalString = this.canonicalizeJson(payload);
    return crypto.createHash('sha256').update(canonicalString, 'utf8').digest('hex');
  }

  /**
   * Deterministically canonicalizes a JSON value by recursively sorting object keys.
   */
  public canonicalizeJson(value: unknown): string {
    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value);
    }

    if (Array.isArray(value)) {
      return '[' + value.map((item) => this.canonicalizeJson(item)).join(',') + ']';
    }

    const obj = value as Record<string, unknown>;
    const sortedKeys = Object.keys(obj).sort();
    const entries = sortedKeys.map(
      (key) => `${JSON.stringify(key)}:${this.canonicalizeJson(obj[key])}`
    );

    return '{' + entries.join(',') + '}';
  }
}
