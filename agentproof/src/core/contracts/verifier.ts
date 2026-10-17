/**
 * AgentProof Core Contracts — IVerifier
 * 
 * Formal interface for verification engine implementations.
 */

import { VerificationRequest } from '../domain/verification-request.js';
import { Evidence } from '../domain/evidence.js';
import { ActionRecord } from '../domain/action-record.js';
import { VerificationResult } from '../domain/verification-result.js';

export interface IVerifier {
  /**
   * Evaluates a VerificationRequest against acquired Evidence and optional ActionRecord
   * using deterministic postcondition rules.
   *
   * @param request The verification specification containing target, intent, and conditions
   * @param evidence Array of independently acquired state snapshots or event receipts
   * @param action Optional claimed action context from the acting agent
   * @returns A structured, evidence-backed VerificationResult
   */
  verify(
    request: VerificationRequest,
    evidence: readonly Evidence[],
    action?: ActionRecord
  ): Promise<VerificationResult>;
}
