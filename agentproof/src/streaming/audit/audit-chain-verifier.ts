/**
 * AgentProof Streaming & Webhooks — Audit Chain Verifier
 * 
 * Verifies cryptographic integrity, sequence continuity, and previous-digest
 * linkage across append-only audit event chains.
 */

import {
  AuditEvent,
  AuditChainVerificationResult,
  GENESIS_PREVIOUS_DIGEST,
} from '../contracts/audit.interface.js';
import { AuditCanonicalizer } from './audit-canonicalizer.js';

export class AuditChainVerifier {
  /**
   * Verifies an array of audit events for a given tenant.
   */
  public static verifyChain(
    events: readonly AuditEvent[],
    expectedTenantId?: string
  ): AuditChainVerificationResult {
    const verifiedAt = new Date().toISOString();

    if (!events || events.length === 0) {
      return {
        isValid: true,
        totalEvents: 0,
        checkedSequences: 0,
        errorCategory: 'EMPTY_CHAIN',
        errorMessage: 'Chain is empty',
        verifiedAt,
      };
    }

    const seenIds = new Set<string>();
    const seenSequences = new Set<number>();

    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      const expectedSeq = i + 1;

      // Check tenant boundary
      if (expectedTenantId && event.tenantId !== expectedTenantId) {
        return {
          isValid: false,
          totalEvents: events.length,
          checkedSequences: i,
          brokenSequence: event.sequenceNumber,
          brokenAuditId: event.auditId,
          errorCategory: 'BROKEN_HASH_LINK',
          errorMessage: `Tenant mismatch at index ${i}: expected ${expectedTenantId}, got ${event.tenantId}`,
          verifiedAt,
        };
      }

      // Check schema version
      if (event.schemaVersion !== '1.0.0') {
        return {
          isValid: false,
          totalEvents: events.length,
          checkedSequences: i,
          brokenSequence: event.sequenceNumber,
          brokenAuditId: event.auditId,
          errorCategory: 'UNSUPPORTED_VERSION',
          errorMessage: `Unsupported schema version '${event.schemaVersion}' at sequence ${event.sequenceNumber}`,
          verifiedAt,
        };
      }

      // Check unique auditId
      if (seenIds.has(event.auditId)) {
        return {
          isValid: false,
          totalEvents: events.length,
          checkedSequences: i,
          brokenSequence: event.sequenceNumber,
          brokenAuditId: event.auditId,
          errorCategory: 'DUPLICATE_AUDIT_ID',
          errorMessage: `Duplicate auditId '${event.auditId}' detected at sequence ${event.sequenceNumber}`,
          verifiedAt,
        };
      }
      seenIds.add(event.auditId);

      // Check sequence number
      if (seenSequences.has(event.sequenceNumber)) {
        return {
          isValid: false,
          totalEvents: events.length,
          checkedSequences: i,
          brokenSequence: event.sequenceNumber,
          brokenAuditId: event.auditId,
          errorCategory: 'DUPLICATE_SEQUENCE',
          errorMessage: `Duplicate sequence number ${event.sequenceNumber} at index ${i}`,
          verifiedAt,
        };
      }
      seenSequences.add(event.sequenceNumber);

      if (event.sequenceNumber !== expectedSeq) {
        return {
          isValid: false,
          totalEvents: events.length,
          checkedSequences: i,
          brokenSequence: event.sequenceNumber,
          brokenAuditId: event.auditId,
          errorCategory: 'SEQUENCE_GAP',
          errorMessage: `Sequence gap at index ${i}: expected ${expectedSeq}, got ${event.sequenceNumber}`,
          verifiedAt,
        };
      }

      // Check previous digest linkage
      if (i === 0) {
        if (event.previousDigest !== GENESIS_PREVIOUS_DIGEST) {
          return {
            isValid: false,
            totalEvents: events.length,
            checkedSequences: i,
            brokenSequence: event.sequenceNumber,
            brokenAuditId: event.auditId,
            errorCategory: 'BROKEN_HASH_LINK',
            errorMessage: `Genesis event sequence 1 must link to genesis digest ${GENESIS_PREVIOUS_DIGEST}, got ${event.previousDigest}`,
            verifiedAt,
          };
        }
      } else {
        const prevEvent = events[i - 1];
        if (event.previousDigest !== prevEvent.currentDigest) {
          return {
            isValid: false,
            totalEvents: events.length,
            checkedSequences: i,
            brokenSequence: event.sequenceNumber,
            brokenAuditId: event.auditId,
            errorCategory: 'BROKEN_HASH_LINK',
            errorMessage: `Hash link broken at sequence ${event.sequenceNumber}: expected previousDigest ${prevEvent.currentDigest}, got ${event.previousDigest}`,
            verifiedAt,
          };
        }
      }

      // Recompute and check currentDigest
      const expectedDigest = AuditCanonicalizer.computeEventDigest(event);
      if (event.currentDigest !== expectedDigest) {
        return {
          isValid: false,
          totalEvents: events.length,
          checkedSequences: i,
          brokenSequence: event.sequenceNumber,
          brokenAuditId: event.auditId,
          errorCategory: 'DIGEST_MISMATCH',
          errorMessage: `Digest mismatch at sequence ${event.sequenceNumber}: stored ${event.currentDigest}, recomputed ${expectedDigest}`,
          verifiedAt,
        };
      }
    }

    return {
      isValid: true,
      totalEvents: events.length,
      checkedSequences: events.length,
      errorCategory: 'VALID',
      verifiedAt,
    };
  }
}
