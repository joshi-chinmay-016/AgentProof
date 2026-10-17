/**
 * AgentProof Phase 5 Test Suite — Evidence Provenance & Trust Validation
 * 
 * Verifies digest integrity, timestamp & clock skew policies, cryptographic attestation,
 * anti-self-elevation guarantees, and tri-state verdict integration.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as crypto from 'node:crypto';
import {
  EvidenceTrustValidator,
  DEFAULT_TRUSTED_SOURCE_CONFIG,
  Evidence,
  VerificationEngine,
  VerificationRequest,
  ActionRecord,
  ReasonCodes,
} from '../../src/core/index.js';

describe('Evidence Trust & Provenance Validation', () => {
  let validator: EvidenceTrustValidator;

  beforeEach(() => {
    validator = new EvidenceTrustValidator();
  });

  function createValidEvidence(payload: unknown, sourceId: string = 'system-reader'): Evidence {
    const canonical = validator.canonicalizeJson(payload);
    const integrityHash = crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');

    return {
      evidenceId: 'ev-test-1',
      evidenceType: 'STATE_SNAPSHOT',
      sourceId,
      sourceKind: 'DIRECT_READ',
      target: { system: 'billing', resourceType: 'sub', resourceId: 'sub-1', tenantId: 'tenant-alpha' },
      observedPayload: payload,
      observedAt: new Date().toISOString(),
      freshnessMs: 0,
      integrityHash,
      limitations: [],
    };
  }

  describe('Payload Canonicalization & Digest Integrity', () => {
    it('produces identical SHA-256 hashes regardless of object key insertion order', () => {
      const obj1 = { a: 1, b: 2, c: { x: 'foo', y: 'bar' } };
      const obj2 = { c: { y: 'bar', x: 'foo' }, b: 2, a: 1 };

      const hash1 = validator.computePayloadHash(obj1);
      const hash2 = validator.computePayloadHash(obj2);

      expect(hash1).toBe(hash2);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    });

    it('validates matching payload digest and flags digest mismatch', () => {
      const validEv = createValidEvidence({ status: 'ACTIVE', count: 42 });
      const reportValid = validator.validate(validEv);

      expect(reportValid.isValid).toBe(true);
      expect(reportValid.digestMatches).toBe(true);
      expect(reportValid.trustLevel).toBe('SOURCE_AUTHENTICATED');

      // Tampered payload
      const tamperedEv: Evidence = {
        ...validEv,
        observedPayload: { status: 'CANCELLED', count: 42 }, // changed!
      };
      const reportTampered = validator.validate(tamperedEv);

      expect(reportTampered.isValid).toBe(false);
      expect(reportTampered.digestMatches).toBe(false);
      expect(reportTampered.trustLevel).toBe('UNVERIFIED');
      expect(reportTampered.limitations).toContain('INTEGRITY_DIGEST_MISMATCH');
    });

    it('rejects unsupported digest algorithms and canonicalization versions', () => {
      const baseEv = createValidEvidence({ status: 'ACTIVE' });

      // Unsupported algorithm: MD5
      const md5Ev: Evidence = {
        ...baseEv,
        digestAlgorithm: 'MD5',
      } as any;
      const reportAlgo = validator.validate(md5Ev);
      expect(reportAlgo.isValid).toBe(false);
      expect(reportAlgo.rejectionReason).toContain('Unsupported digest algorithm');

      // Unsupported canonicalization version: v99
      const canonEv: Evidence = {
        ...baseEv,
        canonicalizationVersion: 'v99',
      } as any;
      const reportCanon = validator.validate(canonEv);
      expect(reportCanon.isValid).toBe(false);
      expect(reportCanon.rejectionReason).toContain('Unsupported canonicalization version');
    });
  });

  describe('Timestamp Validity & Freshness Tolerances', () => {
    it('rejects malformed and excessive future timestamps', () => {
      const baseEv = createValidEvidence({ ok: true });

      // Malformed ISO string
      const malformedEv: Evidence = {
        ...baseEv,
        observedAt: 'not-a-valid-timestamp',
      };
      const reportMalformed = validator.validate(malformedEv);
      expect(reportMalformed.isValid).toBe(false);
      expect(reportMalformed.limitations).toContain('INVALID_OBSERVED_TIMESTAMP');

      // Future timestamp beyond 10s clock skew
      const futureTime = new Date(Date.now() + 60000).toISOString();
      const futureEv: Evidence = {
        ...baseEv,
        observedAt: futureTime,
      };
      const reportFuture = validator.validate(futureEv);
      expect(reportFuture.isValid).toBe(false);
      expect(reportFuture.limitations).toContain('FUTURE_TIMESTAMP_EXCEEDS_CLOCK_SKEW');
    });

    it('flags stale observations relative to action invocation', () => {
      const baseEv = createValidEvidence({ ok: true });
      const action: ActionRecord = {
        actionId: 'act-1',
        toolName: 'update',
        target: baseEv.target,
        sanitizedArgs: {},
        executionStatus: 'REPORTED_SUCCESS',
        reportedResult: null,
        invokedAt: '2026-10-17T12:00:00.000Z',
        completedAt: '2026-10-17T12:00:01.000Z',
      };

      // Observation 2 hours prior to action start (exceeds default 60s tolerance)
      const staleEv: Evidence = {
        ...baseEv,
        observedAt: '2026-10-17T10:00:00.000Z',
      };

      const report = validator.validate(
        staleEv,
        baseEv.target,
        { timeoutMs: 5000, requireIndependentSource: true, freshnessToleranceMs: 60000 },
        action,
        new Date('2026-10-17T12:01:00.000Z').getTime()
      );

      expect(report.isFresh).toBe(false);
      expect(report.limitations).toContain('STALE_EVIDENCE');
    });
  });

  describe('Source Provenance & Anti-Self-Elevation', () => {
    it('prevents callers from self-elevating trustLevel without verification', () => {
      const ev = createValidEvidence({ data: 123 }, 'untrusted-custom-agent');
      // Untrusted caller maliciously claims ATTESTED trust level
      const elevatedEv: Evidence = {
        ...ev,
        provenance: {
          trustLevel: 'ATTESTED',
        },
      };

      const report = validator.validate(elevatedEv);

      // Must NOT be ATTESTED since signature is missing and source is unauthenticated
      expect(report.trustLevel).not.toBe('ATTESTED');
      expect(report.trustLevel).toBe('INTEGRITY_CHECKED');
    });

    it('authenticates sources matching trusted registry', () => {
      const trustedEv = createValidEvidence({ ok: true }, 'system-reader');
      const untrustedEv = createValidEvidence({ ok: true }, 'random-third-party-caller');

      const trustedReport = validator.validate(trustedEv);
      const untrustedReport = validator.validate(untrustedEv);

      expect(trustedReport.trustLevel).toBe('SOURCE_AUTHENTICATED');
      expect(untrustedReport.trustLevel).toBe('INTEGRITY_CHECKED');
    });

    it('verifies cryptographic attestations with public keys', () => {
      // Generate test keypair
      const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
      });

      const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
      const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

      const customValidator = new EvidenceTrustValidator({
        attestationPublicKeys: new Map([['test-key-1', publicKeyPem]]),
      });

      const payload = { auditEvent: 'SEC_LOG_VERIFIED', status: 'CONFIRMED' };
      const baseEv = createValidEvidence(payload, 'audit-service');

      // Create genuine attestation signature
      const canonical = customValidator.canonicalizeJson(payload);
      const signer = crypto.createSign('SHA256');
      signer.update(`${baseEv.evidenceId}:${baseEv.observedAt}:${canonical}`);
      signer.end();
      const validSigHex = signer.sign(privateKeyPem, 'hex');

      // Attested evidence item
      const attestedEv: Evidence = {
        ...baseEv,
        provenance: {
          observerIdentity: 'secure-hardware-enclave',
          observerType: 'ATTESTED',
          attestationKeyId: 'test-key-1',
          attestationSignature: validSigHex,
        },
      };

      const validReport = customValidator.validate(attestedEv);
      expect(validReport.trustLevel).toBe('ATTESTED');
      expect(validReport.isValid).toBe(true);

      // Tampered signature rejection
      const forgedEv: Evidence = {
        ...attestedEv,
        provenance: {
          ...attestedEv.provenance,
          attestationSignature: 'deadbeef12345678', // Bogus signature!
        },
      };

      const forgedReport = customValidator.validate(forgedEv);
      expect(forgedReport.trustLevel).not.toBe('ATTESTED');
      expect(forgedReport.limitations).toContain('INVALID_ATTESTATION_SIGNATURE');
    });

    it('explicitly labels simulated observation sources', () => {
      const simEv = createValidEvidence({ seats: 10 }, 'simulated-subscription-reader');
      const report = validator.validate(simEv);

      expect(report.limitations).toContain('SIMULATED_OBSERVATION_SOURCE');
    });
  });

  describe('Tri-State Verdict Engine Integration', () => {
    it('produces INCONCLUSIVE (never PASS) when evidence is untrusted or corrupted', async () => {
      const engine = new VerificationEngine();

      const request: VerificationRequest = {
        schemaVersion: '1.0.0',
        requestId: 'req-verify-untrusted',
        timestamp: '2026-10-17T12:00:00.000Z',
        target: { system: 'billing', resourceType: 'sub', resourceId: 'sub-1', tenantId: 'tenant-alpha' },
        intent: { operation: 'upgrade', summary: 'upgrade plan', expectedChanges: { plan: 'enterprise' } },
        preconditions: [],
        postconditions: [
          {
            id: 'post-plan',
            description: 'Plan must be enterprise',
            path: 'plan',
            operator: 'EQUALS',
            expectedValue: 'enterprise',
            enforcement: 'REQUIRED',
          },
        ],
        policy: { timeoutMs: 5000, requireIndependentSource: true, freshnessToleranceMs: 60000 },
      };

      // Corrupted evidence item tagged with limitation
      const corruptedEvidence: Evidence = {
        evidenceId: 'ev-bad-1',
        evidenceType: 'STATE_SNAPSHOT',
        sourceId: 'db',
        sourceKind: 'DIRECT_READ',
        target: request.target,
        observedPayload: { plan: 'enterprise' },
        observedAt: '2026-10-17T12:00:00.000Z',
        freshnessMs: 0,
        integrityHash: 'hash',
        limitations: ['INTEGRITY_DIGEST_MISMATCH'], // flagged by validator
      };

      const result = await engine.verify(request, [corruptedEvidence]);

      // Rule 4 & Rule 7: Invalid evidence MUST NOT produce PASS or false FAIL; it must yield INCONCLUSIVE!
      expect(result.overallVerdict).toBe('INCONCLUSIVE');
      expect(result.conditionEvaluations[0].reasonCode).toBe(ReasonCodes.INC_UNTRUSTED_EVIDENCE);
    });
  });
});
