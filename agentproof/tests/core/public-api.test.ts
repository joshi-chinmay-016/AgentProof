import { describe, it, expect } from 'vitest';
// Import directly from the core public entry point as an external consumer
import {
  VerificationEngine,
  IVerifier,
  ReasonCodes,
  VerificationRequest,
  Evidence,
  Verdict,
} from '../../src/core/index.js';

describe('Core Public API Consumer Usage', () => {
  it('Allows consumers to instantiate IVerifier via public exports without NitroStack context', async () => {
    const verifier: IVerifier = new VerificationEngine();
    expect(verifier).toBeDefined();
    expect(typeof verifier.verify).toBe('function');
  });

  it('Exposes ReasonCodes enum constants to consumers', () => {
    expect(ReasonCodes.PASS_ALL_CONDITIONS_VERIFIED).toBe('PASS_ALL_CONDITIONS_VERIFIED');
    expect(ReasonCodes.FAIL_VALUE_MISMATCH).toBe('FAIL_VALUE_MISMATCH');
    expect(ReasonCodes.INC_EVIDENCE_NOT_FOUND).toBe('INC_EVIDENCE_NOT_FOUND');
  });

  it('Allows strongly typed verification workflow for third-party consumers', async () => {
    const verifier: IVerifier = new VerificationEngine();

    const request: VerificationRequest = {
      schemaVersion: '1.0.0',
      requestId: 'req_consumer_test_01',
      timestamp: '2026-10-17T12:00:00.000Z',
      target: {
        system: 'user_service',
        resourceType: 'user_profile',
        resourceId: 'usr_882',
      },
      intent: {
        operation: 'deactivate_user',
        summary: 'Deactivate user profile',
        expectedChanges: { active: false },
      },
      preconditions: [],
      postconditions: [
        {
          id: 'post_active_false',
          description: 'Profile status must be inactive',
          path: 'active',
          operator: 'EQUALS',
          expectedValue: false,
          enforcement: 'REQUIRED',
        },
      ],
      policy: {
        timeoutMs: 3000,
        requireIndependentSource: true,
        freshnessToleranceMs: 30000,
      },
    };

    const evidence: Evidence[] = [
      {
        evidenceId: 'ev_user_01',
        evidenceType: 'STATE_SNAPSHOT',
        sourceId: 'user_db_reader',
        sourceKind: 'DIRECT_READ',
        target: {
          system: 'user_service',
          resourceType: 'user_profile',
          resourceId: 'usr_882',
        },
        observedPayload: {
          id: 'usr_882',
          active: false,
        },
        observedAt: '2026-10-17T12:00:01.000Z',
        freshnessMs: 50,
        integrityHash: 'sha256_mock_hash_user',
        limitations: [],
      },
    ];

    const result = await verifier.verify(request, evidence);
    const verdict: Verdict = result.overallVerdict;

    expect(verdict).toBe('PASS');
    expect(result.summary).toContain('All 1 required postcondition(s) verified');
  });
});
