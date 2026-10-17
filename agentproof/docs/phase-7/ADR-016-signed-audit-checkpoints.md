# ADR-016: Signed Audit Checkpoints

## Status
Accepted

## Context
While a local hash chain detects uncoordinated row modifications, it cannot mathematically prevent a privileged adversary with storage root access from replacing the entire historical log from sequence 1 to N with internally consistent recomputed digests. To detect whole-history rewriting without introducing distributed blockchain dependencies, cryptographic checkpoints signed by an authoritative key are required.

## Decision
1. **Asymmetric Checkpoints:** `AuditCheckpointManager` generates periodic checkpoints binding:
   - `tenantId`
   - `sequenceNumber`
   - `chainDigest` (latest `currentDigest` in the chain)
   - `timestamp`
   - `keyId`
   - `signature`: RSA-SHA256 signature generated using a configured private key.
2. **Separation of Responsibilities:** Private signing keys are held by secure signing authorities. Verification uses trusted public keys (`verifyCheckpoint`).
3. **Explicit Tampering Invariant:** We explicitly document and test the limitation that a local hash chain alone cannot detect a whole-chain rewrite, but checking against an externally held or separately signed checkpoint reveals the mismatch.
4. **No Blockchain Requirement:** Checkpoints operate cleanly on local filesystems with extension points for RFC 3161 timestamping authorities or external transparency logs in future phases.

## Consequences
- Privileged full-history rewrites are detected whenever current chain head does not match trusted signed checkpoints.
- Avoids complex external cloud or blockchain dependencies in Phase 7 while providing mathematically rigorous guarantees.
