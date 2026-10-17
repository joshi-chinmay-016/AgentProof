# AgentProof Tamper-Evident Audit Integrity & Signed Checkpoints

## 1. Overview and Threat Model

To provide cryptographic auditability for AI-agent verifications, AgentProof implements an append-only, tamper-evident hash chain partitioned per tenant, supplemented with asymmetric RSA-SHA256 signed checkpoints.

### Target Protections
1. **Payload Modification Detection**: Any modification to a recorded audit payload or its digest breaks the link.
2. **Deletion Detection**: Removing any historical record creates a sequence gap.
3. **Reordering Detection**: Changing sequence order breaks the previous digest link.
4. **Insertion Detection**: Inserting a forged event into an existing chain breaks the hash chain linkage.

---

## 2. Audit Event Schema & Canonicalization

Each audit event conforms to schema version `1.0.0`:

```typescript
export interface AuditEvent {
  schemaVersion: '1.0.0';
  auditId: string;                      // Unique event UUID
  tenantId: string;                     // Tenant isolation boundary
  sequenceNumber: number;               // Monotonically increasing: 1, 2, 3...
  eventType: string;                    // e.g. VERIFICATION_COMPLETED
  entityId: string;                     // Target trace ID or event ID
  timestamp: string;                    // ISO-8601 audit timestamp
  payloadDigest: string;                // SHA-256 of canonical payload
  previousDigest: string;               // currentDigest of sequence (N - 1)
  currentDigest: string;                // Hash of this record's canonical fields
  metadata?: Record<string, unknown>;   // Optional non-authoritative metadata
}
```

### Deterministic Canonicalization
`AuditCanonicalizer` recursively sorts all object keys in ASCII order and serializes arrays and primitives consistently without whitespace variation:

```typescript
// Hash calculation for event N:
currentDigest = SHA256(canonical({
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
}));
```

For the genesis event (`sequenceNumber === 1`):
`previousDigest = "0000000000000000000000000000000000000000000000000000000000000000"`

---

## 3. Chain Verification (`AuditChainVerifier`)

`AuditChainVerifier.verifyChain(events, expectedTenantId)` verifies:
1. **Sequence Continuity**: `events[i].sequenceNumber === i + 1` with no gaps or duplicates.
2. **Hash Linkage**: For `i > 0`, `events[i].previousDigest === events[i - 1].currentDigest`.
3. **Digest Integrity**: Recomputes `AuditCanonicalizer.computeEventDigest(event)` and confirms equality with `event.currentDigest`.
4. **Identity Uniqueness**: No duplicate `auditId` exists in the chain.
5. **Tenant Scoping**: All events belong to `expectedTenantId`.

Failures return structured categories: `BROKEN_HASH_LINK`, `DIGEST_MISMATCH`, `SEQUENCE_GAP`, `DUPLICATE_SEQUENCE`, `DUPLICATE_AUDIT_ID`, or `UNSUPPORTED_VERSION`.

---

## 4. Signed Audit Checkpoints (`AuditCheckpointManager`)

While a hash chain protects against uncoordinated record modification, a privileged actor with local storage write access could recompute every hash from sequence 1 to N.

To detect whole-chain rewrites, AgentProof provides RSA-SHA256 signed checkpoints:

```typescript
export interface AuditCheckpoint {
  schemaVersion: '1.0.0';
  checkpointId: string;
  tenantId: string;
  sequenceNumber: number;
  chainDigest: string;                 // currentDigest of the latest event
  timestamp: string;
  keyId: string;
  signatureAlgorithm: 'RSA-SHA256';
  signature: string;                   // Base64 RSA signature over canonical checkpoint
}
```

Signing canon:
```typescript
AuditCanonicalizer.canonicalize({
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
```

---

## 5. Critical Tampering Limitation

> [!WARNING]
> **Cryptographic Boundary Limitation:**
> A local hash chain alone **CANNOT** mathematically prevent an attacker with full filesystem or database overwrite permissions from replacing the entire history from scratch with internally consistent recomputed digests.

This limitation is proven by automated test `demonstrates that a full-history rewrite passes local hash verification but FAILS signed checkpoint verification`:
1. If an attacker rewrites all events, the local hash chain verifier considers the rewritten history internally valid.
2. However, comparing the rewritten chain's digest against a separately distributed or externally anchored **signed checkpoint** immediately detects the fraud.
3. Therefore, production deployments should export signed checkpoints to an independent write-once audit log or external anchoring store.
