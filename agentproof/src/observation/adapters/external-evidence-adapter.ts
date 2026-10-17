/**
 * AgentProof Observation — ExternalEvidenceAdapter
 * 
 * Bridges ExternalObservationRecord items into standard Evidence objects.
 * Applies deterministic canonicalization, computes SHA-256 integrityHash,
 * assigns SOURCE_AUTHENTICATED trust provenance for authenticated external integrations,
 * and preserves failure metadata without fabricating evidence.
 */

import * as crypto from 'node:crypto';
import {
  Evidence,
  EvidenceSchema,
  EvidenceType,
  SourceKind,
} from '../../core/index.js';
import { ExternalObservationRecord } from '../contracts/state-reader.interface.js';

export interface ExternalEvidenceAdapterOptions {
  readonly defaultEvidenceType?: EvidenceType;
  readonly defaultSourceKind?: SourceKind;
}

export class ExternalEvidenceAdapter {
  private readonly defaultEvidenceType: EvidenceType;
  private readonly defaultSourceKind: SourceKind;

  constructor(options?: ExternalEvidenceAdapterOptions) {
    this.defaultEvidenceType = options?.defaultEvidenceType ?? 'STATE_SNAPSHOT';
    this.defaultSourceKind = options?.defaultSourceKind ?? 'EXTERNAL_API';
  }

  /**
   * Converts an ExternalObservationRecord into an Evidence object.
   * If the observation failed with READ_ERROR and includeFailureRecord is false (default),
   * returns null to prevent fabricating evidence.
   */
  public toEvidence(
    record: ExternalObservationRecord,
    options?: {
      readonly evidenceId?: string;
      readonly includeFailureRecord?: boolean;
    }
  ): Evidence | null {
    if (record.status === 'READ_ERROR' && !options?.includeFailureRecord) {
      return null;
    }

    const evidenceId = options?.evidenceId ?? `ev-ext-${crypto.randomUUID().slice(0, 8)}`;
    const limitations: string[] = [...(record.limitations ?? [])];

    let observedPayload: unknown = null;
    let observationStatus: 'FOUND' | 'NOT_FOUND' | 'ERROR' = 'FOUND';

    if (record.status === 'FOUND') {
      observedPayload = record.payload;
      observationStatus = 'FOUND';
    } else if (record.status === 'NOT_FOUND') {
      observedPayload = null;
      observationStatus = 'NOT_FOUND';
      limitations.push('RESOURCE_NOT_FOUND_IN_SYSTEM_OF_RECORD');
    } else {
      // READ_ERROR or UNTRUSTED
      observedPayload = {
        error: true,
        errorCategory: record.errorCategory ?? 'UNKNOWN',
        errorMessage: record.errorMessage ?? 'Observation read error',
      };
      observationStatus = 'ERROR';
      limitations.push('OBSERVATION_FAILED_READ_ERROR');
      if (record.errorCategory === 'TIMEOUT') {
        limitations.push('READER_TIMEOUT');
      } else {
        limitations.push('READER_ERROR');
      }
    }

    const integrityHash = this.computePayloadHash(observedPayload);
    const nowMs = Date.now();
    const obsTimeMs = new Date(record.observedAt).getTime();
    const freshnessMs = Math.max(0, nowMs - (isNaN(obsTimeMs) ? nowMs : obsTimeMs));

    const evidence: Evidence = {
      evidenceId,
      evidenceType: this.defaultEvidenceType,
      sourceId: record.sourceId,
      sourceKind: this.defaultSourceKind,
      target: record.target,
      observedPayload,
      observedAt: record.observedAt,
      freshnessMs,
      integrityHash,
      digestAlgorithm: 'SHA-256',
      canonicalizationVersion: 'v1',
      schemaVersion: '1.0.0',
      observationStatus,
      limitations,
      provenance: {
        observerIdentity: record.sourceId,
        observerType: 'EXTERNAL',
        trustLevel: 'SOURCE_AUTHENTICATED',
      },
    };

    return EvidenceSchema.parse(evidence) as Evidence;
  }

  /**
   * Converts a list of ExternalObservationRecords to Evidence objects,
   * filtering out failures by default.
   */
  public toEvidenceList(
    records: readonly ExternalObservationRecord[],
    options?: { readonly includeFailureRecord?: boolean }
  ): readonly Evidence[] {
    const list: Evidence[] = [];
    for (const record of records) {
      const ev = this.toEvidence(record, options);
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

    if (value instanceof Date) {
      return JSON.stringify(value.toISOString());
    }

    if (Array.isArray(value)) {
      return '[' + value.map((item) => this.canonicalizeJson(item)).join(',') + ']';
    }

    const obj = value as Record<string, unknown>;
    const sortedKeys = Object.keys(obj).sort();
    const entries = sortedKeys
      .filter((key) => obj[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${this.canonicalizeJson(obj[key])}`);

    return '{' + entries.join(',') + '}';
  }
}
