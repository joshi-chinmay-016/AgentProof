/**
 * AgentProof Core Verification — Evidence Trust Validator
 * 
 * Validates evidence integrity, freshness, provenance, and authenticity.
 * Distinguishes payload integrity (cryptographic digest) from evidence authenticity (trusted source).
 * Enforces that callers cannot self-elevate their trust levels.
 */

import * as crypto from 'node:crypto';
import { Evidence, EvidenceTrustLevel } from '../domain/evidence.js';
import { ResourceTarget, VerificationPolicy } from '../domain/verification-request.js';
import { ActionRecord } from '../domain/action-record.js';

export interface EvidenceTrustReport {
  readonly evidenceId: string;
  readonly isValid: boolean;
  readonly trustLevel: EvidenceTrustLevel;
  readonly digestMatches: boolean;
  readonly isFresh: boolean;
  readonly targetMatches: boolean;
  readonly sourceAuthenticated: boolean;
  readonly limitations: readonly string[];
  readonly rejectionReason?: string;
}

export interface TrustedSourceConfig {
  readonly trustedSourceIds: ReadonlySet<string>;
  readonly attestationPublicKeys?: ReadonlyMap<string, string>;
  readonly maxClockSkewMs?: number;
  readonly allowedAlgorithms?: ReadonlySet<string>;
  readonly allowedCanonicalizationVersions?: ReadonlySet<string>;
}

export const DEFAULT_TRUSTED_SOURCE_CONFIG: TrustedSourceConfig = {
  trustedSourceIds: new Set([
    'simulated-subscription-reader',
    'system-reader',
    'direct-reader',
    'audit-service',
  ]),
  maxClockSkewMs: 10000,
  allowedAlgorithms: new Set(['SHA-256', 'sha256']),
  allowedCanonicalizationVersions: new Set(['v1', '1.0.0']),
};

export class EvidenceTrustValidator {
  private readonly config: TrustedSourceConfig;

  constructor(config?: Partial<TrustedSourceConfig>) {
    this.config = {
      trustedSourceIds: config?.trustedSourceIds ?? DEFAULT_TRUSTED_SOURCE_CONFIG.trustedSourceIds,
      attestationPublicKeys: config?.attestationPublicKeys ?? DEFAULT_TRUSTED_SOURCE_CONFIG.attestationPublicKeys,
      maxClockSkewMs: config?.maxClockSkewMs ?? DEFAULT_TRUSTED_SOURCE_CONFIG.maxClockSkewMs ?? 10000,
      allowedAlgorithms: config?.allowedAlgorithms ?? DEFAULT_TRUSTED_SOURCE_CONFIG.allowedAlgorithms ?? new Set(['SHA-256', 'sha256']),
      allowedCanonicalizationVersions: config?.allowedCanonicalizationVersions ?? DEFAULT_TRUSTED_SOURCE_CONFIG.allowedCanonicalizationVersions ?? new Set(['v1', '1.0.0']),
    };
  }

  /**
   * Validates an individual Evidence item.
   */
  public validate(
    evidence: Evidence,
    expectedTarget?: ResourceTarget,
    policy?: VerificationPolicy,
    action?: ActionRecord,
    nowMs: number = Date.now()
  ): EvidenceTrustReport {
    const limitations: string[] = [...(evidence.limitations || [])];

    // 1. Validate Digest Algorithm and Canonicalization Version if specified
    const digestAlgorithm = (evidence as any).digestAlgorithm ?? 'SHA-256';
    if (!this.config.allowedAlgorithms?.has(digestAlgorithm)) {
      return {
        evidenceId: evidence.evidenceId,
        isValid: false,
        trustLevel: 'UNVERIFIED',
        digestMatches: false,
        isFresh: false,
        targetMatches: false,
        sourceAuthenticated: false,
        limitations: [...limitations, 'UNSUPPORTED_DIGEST_ALGORITHM'],
        rejectionReason: `Unsupported digest algorithm '${digestAlgorithm}'. Supported algorithms: ${Array.from(this.config.allowedAlgorithms ?? []).join(', ')}`,
      };
    }

    const canonVersion = (evidence as any).canonicalizationVersion ?? 'v1';
    if (!this.config.allowedCanonicalizationVersions?.has(canonVersion)) {
      return {
        evidenceId: evidence.evidenceId,
        isValid: false,
        trustLevel: 'UNVERIFIED',
        digestMatches: false,
        isFresh: false,
        targetMatches: false,
        sourceAuthenticated: false,
        limitations: [...limitations, 'UNSUPPORTED_CANONICALIZATION_VERSION'],
        rejectionReason: `Unsupported canonicalization version '${canonVersion}'. Supported versions: ${Array.from(this.config.allowedCanonicalizationVersions ?? []).join(', ')}`,
      };
    }

    // 2. Compute canonical digest and compare against integrityHash
    const computedHash = this.computePayloadHash(evidence.observedPayload);
    const digestMatches = evidence.integrityHash === computedHash;

    if (!digestMatches) {
      return {
        evidenceId: evidence.evidenceId,
        isValid: false,
        trustLevel: 'UNVERIFIED',
        digestMatches: false,
        isFresh: false,
        targetMatches: false,
        sourceAuthenticated: false,
        limitations: [...limitations, 'INTEGRITY_DIGEST_MISMATCH'],
        rejectionReason: `Evidence digest mismatch: supplied integrityHash [${evidence.integrityHash}] does not match computed SHA-256 [${computedHash}].`,
      };
    }

    // 3. Timestamp Validity and Clock Skew
    const obsTime = new Date(evidence.observedAt).getTime();
    if (isNaN(obsTime)) {
      return {
        evidenceId: evidence.evidenceId,
        isValid: false,
        trustLevel: 'UNVERIFIED',
        digestMatches: true,
        isFresh: false,
        targetMatches: false,
        sourceAuthenticated: false,
        limitations: [...limitations, 'INVALID_OBSERVED_TIMESTAMP'],
        rejectionReason: `Evidence observedAt [${evidence.observedAt}] is not a valid timestamp.`,
      };
    }

    const maxSkew = this.config.maxClockSkewMs ?? 10000;
    if (obsTime > nowMs + maxSkew) {
      return {
        evidenceId: evidence.evidenceId,
        isValid: false,
        trustLevel: 'UNVERIFIED',
        digestMatches: true,
        isFresh: false,
        targetMatches: false,
        sourceAuthenticated: false,
        limitations: [...limitations, 'FUTURE_TIMESTAMP_EXCEEDS_CLOCK_SKEW'],
        rejectionReason: `Evidence observedAt [${evidence.observedAt}] is in the future beyond maximum allowed clock skew (${maxSkew}ms).`,
      };
    }

    // 4. Freshness Validation relative to action
    let isFresh = true;
    if (action) {
      const actionTime = new Date(action.invokedAt).getTime();
      const tolerance = policy?.freshnessToleranceMs ?? 60000;
      if (obsTime < actionTime - tolerance) {
        isFresh = false;
        limitations.push('STALE_EVIDENCE');
      }
    }

    // 5. Target Scope Matching
    let targetMatches = true;
    if (expectedTarget) {
      if (
        evidence.target.system !== expectedTarget.system ||
        evidence.target.resourceType !== expectedTarget.resourceType ||
        evidence.target.resourceId !== expectedTarget.resourceId
      ) {
        targetMatches = false;
        limitations.push('TARGET_RESOURCE_MISMATCH');
      }

      if (expectedTarget.tenantId && evidence.target.tenantId && evidence.target.tenantId !== expectedTarget.tenantId) {
        targetMatches = false;
        limitations.push('TENANT_MISMATCH');
      }
    }

    // 6. Source Authenticity & Trust Level Derivation
    // Note: NEVER trust caller-asserted trustLevel. Derive it from verified properties.
    const isSourceAuthenticated = this.config.trustedSourceIds.has(evidence.sourceId);

    // Check for simulated source labelling
    if (evidence.sourceId.includes('simulated') || (evidence as any).provenance?.observerType === 'SIMULATED') {
      limitations.push('SIMULATED_OBSERVATION_SOURCE');
    }

    // Check cryptographic attestation if present
    let isAttested = false;
    const provenance = (evidence as any).provenance;
    if (provenance?.attestationSignature && provenance?.attestationKeyId) {
      isAttested = this.verifyAttestation(
        evidence,
        provenance.attestationKeyId,
        provenance.attestationSignature
      );
      if (!isAttested) {
        limitations.push('INVALID_ATTESTATION_SIGNATURE');
      }
    }

    let derivedTrustLevel: EvidenceTrustLevel = 'INTEGRITY_CHECKED';
    if (isAttested) {
      derivedTrustLevel = 'ATTESTED';
    } else if (isSourceAuthenticated) {
      derivedTrustLevel = 'SOURCE_AUTHENTICATED';
    } else {
      derivedTrustLevel = 'INTEGRITY_CHECKED';
    }

    // If target doesn't match or is stale, the evidence is not valid for satisfying postconditions
    const isValid = digestMatches && targetMatches && isFresh;

    return {
      evidenceId: evidence.evidenceId,
      isValid,
      trustLevel: derivedTrustLevel,
      digestMatches: true,
      isFresh,
      targetMatches,
      sourceAuthenticated: isSourceAuthenticated,
      limitations: Object.freeze(limitations),
      rejectionReason: !isValid ? limitations.join('; ') : undefined,
    };
  }

  /**
   * Validates a collection of Evidence items and returns a mapping by evidenceId.
   */
  public validateAll(
    evidenceList: readonly Evidence[],
    expectedTarget?: ResourceTarget,
    policy?: VerificationPolicy,
    action?: ActionRecord
  ): ReadonlyMap<string, EvidenceTrustReport> {
    const reports = new Map<string, EvidenceTrustReport>();
    const now = Date.now();
    for (const ev of evidenceList) {
      const report = this.validate(ev, expectedTarget, policy, action, now);
      reports.set(ev.evidenceId, report);
    }
    return reports;
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

  /**
   * Computes SHA-256 of canonicalized payload.
   */
  public computePayloadHash(payload: unknown): string {
    const canonicalString = this.canonicalizeJson(payload);
    return crypto.createHash('sha256').update(canonicalString, 'utf8').digest('hex');
  }

  /**
   * Verifies an attestation signature if a key is registered.
   */
  private verifyAttestation(evidence: Evidence, keyId: string, signatureHex: string): boolean {
    const key = this.config.attestationPublicKeys?.get(keyId);
    if (!key) return false;

    try {
      const canonical = this.canonicalizeJson(evidence.observedPayload);
      const verify = crypto.createVerify('SHA256');
      verify.update(`${evidence.evidenceId}:${evidence.observedAt}:${canonical}`);
      verify.end();
      return verify.verify(key, signatureHex, 'hex');
    } catch {
      return false;
    }
  }
}
