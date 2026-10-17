# ADR-015: Tamper-Evident Audit Chain

## Status
Accepted

## Context
AI-agent operations and deterministic verification traces require an append-only, tamper-evident audit history. If audit records can be silently edited, removed, or reordered without detection, the system cannot prove to compliance authorities or users that a verification outcome was uncorrupted.

## Decision
1. **Cryptographic Hash Chain:** Audit events are linked sequentially per tenant. Each event records:
   - `sequenceNumber`: 1, 2, 3...
   - `previousDigest`: Hash of event N-1 (or genesis constant for sequence 1).
   - `payloadDigest`: SHA-256 of canonicalized payload.
   - `currentDigest`: SHA-256 of the domain-separated canonical event record (`AGENTPROOF_AUDIT_EVENT_V1`).
2. **Deterministic Canonicalization:** Implemented via `AuditCanonicalizer`, recursively sorting all JSON object keys to eliminate formatting ambiguity.
3. **Continuous Verification:** `AuditChainVerifier` validates sequence continuity, previous digest links, and recomputed current digests, reporting specific error categories (`BROKEN_HASH_LINK`, `DIGEST_MISMATCH`, `SEQUENCE_GAP`, `DUPLICATE_SEQUENCE`, `DUPLICATE_AUDIT_ID`).
4. **Append-Only File Persistence:** `FileAuditEventRepository` stores tenant chains atomically using temporary file renaming and per-tenant concurrency locks.

## Consequences
- Any alteration to payload, sequence order, or hash digest is cryptographically detected.
- Historical deletion creates an unmistakable sequence gap.
- Single-host storage provides strong tampering detection under non-privileged modification scenarios.
