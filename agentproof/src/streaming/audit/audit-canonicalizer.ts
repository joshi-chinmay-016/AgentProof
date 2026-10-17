/**
 * AgentProof Streaming & Webhooks — Audit Event Canonicalizer & Hasher
 * 
 * Provides deterministic JSON canonicalization and domain-separated SHA-256
 * digest computations for audit chain nodes and audit checkpoints.
 */

import * as crypto from 'node:crypto';
import { AuditEvent, AuditCheckpoint } from '../contracts/audit.interface.js';

export class AuditCanonicalizer {
  /**
   * Deterministically canonicalizes any JSON value by recursively sorting object keys.
   */
  public static canonicalize(value: unknown): string {
    if (value === null || value === undefined) {
      return 'null';
    }
    if (typeof value === 'boolean' || typeof value === 'number') {
      return JSON.stringify(value);
    }
    if (typeof value === 'string') {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return '[' + value.map((item) => AuditCanonicalizer.canonicalize(item)).join(',') + ']';
    }
    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj).sort();
      return '{' + keys.map((k) => `${JSON.stringify(k)}:${AuditCanonicalizer.canonicalize(obj[k])}`).join(',') + '}';
    }
    return JSON.stringify(value);
  }

  /**
   * Computes canonical SHA-256 of an arbitrary payload.
   */
  public static computePayloadDigest(payload: unknown): string {
    const canonical = AuditCanonicalizer.canonicalize(payload);
    return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
  }

  /**
   * Computes the domain-separated currentDigest for an AuditEvent.
   * 
   * Hash chain formula:
   * SHA-256(canonical({
   *   _domain: 'AGENTPROOF_AUDIT_EVENT_V1',
   *   algorithm: 'SHA-256',
   *   schemaVersion: '1.0.0',
   *   sequenceNumber,
   *   tenantId,
   *   eventType,
   *   entityId,
   *   timestamp,
   *   payloadDigest,
   *   previousDigest
   * }))
   */
  public static computeEventDigest(
    event: Omit<AuditEvent, 'currentDigest'>
  ): string {
    const canonicalRepresentation = AuditCanonicalizer.canonicalize({
      _domain: 'AGENTPROOF_AUDIT_EVENT_V1',
      algorithm: 'SHA-256',
      entityId: event.entityId,
      eventType: event.eventType,
      payloadDigest: event.payloadDigest,
      previousDigest: event.previousDigest,
      schemaVersion: event.schemaVersion,
      sequenceNumber: event.sequenceNumber,
      tenantId: event.tenantId,
      timestamp: event.timestamp,
    });

    return crypto.createHash('sha256').update(canonicalRepresentation, 'utf8').digest('hex');
  }

  /**
   * Constructs the canonical string representation of an AuditCheckpoint for RSA signing/verification.
   */
  public static canonicalizeCheckpoint(
    checkpoint: Omit<AuditCheckpoint, 'signature'>
  ): string {
    return AuditCanonicalizer.canonicalize({
      _domain: 'AGENTPROOF_AUDIT_CHECKPOINT_V1',
      chainDigest: checkpoint.chainDigest,
      checkpointId: checkpoint.checkpointId,
      keyId: checkpoint.keyId,
      schemaVersion: checkpoint.schemaVersion,
      sequenceNumber: checkpoint.sequenceNumber,
      signatureAlgorithm: checkpoint.signatureAlgorithm,
      tenantId: checkpoint.tenantId,
      timestamp: checkpoint.timestamp,
    });
  }
}
