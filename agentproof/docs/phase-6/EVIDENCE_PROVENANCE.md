# Evidence Provenance & Trust Levels in Phase 6

## 1. Overview

AgentProof maintains an evidence pipeline where every observation is canonicalized, hashed with SHA-256, and assigned a derived trust level based on verified origin.

Phase 6 connects real external readers into this pipeline via `ExternalEvidenceAdapter` and `EvidenceTrustValidator`.

---

## 2. Converting Observations to Evidence

When an external reader completes an observation:
1. **Payload Extraction:**
   - If `status === 'FOUND'`, the raw record becomes `observedPayload`.
   - If `status === 'NOT_FOUND'`, `observedPayload` is `null`, and `'RESOURCE_NOT_FOUND_IN_SYSTEM_OF_RECORD'` is added to limitations.
   - If `status === 'READ_ERROR'`, `observedPayload` records the safe error category without fabricating application data.
2. **Deterministic Canonicalization (v1):**
   Object keys are recursively sorted lexicographically to produce an invariant JSON string.
3. **Cryptographic Integrity Hash:**
   Computed via `SHA-256` over the canonical string.
4. **Source Registration:**
   The integration's `sourceId` is registered in `EvidenceTrustValidator` to authenticate the source.

---

## 3. Trust Level Hierarchy

AgentProof distinguishes payload integrity from source authenticity:

```
[ UNVERIFIED ]
     |
     v
[ INTEGRITY_CHECKED ]   (Payload matches computed SHA-256 digest)
     |
     v
[ SOURCE_AUTHENTICATED ] (Acquired from configured, authenticated integration)
     |
     v
[ ATTESTED ]             (Cryptographically signed with verified asymmetric key pair)
```

### Critical Provenance Rules
1. **No Self-Elevation:** Callers over MCP cannot claim `trustLevel: 'SOURCE_AUTHENTICATED'` or `trustLevel: 'ATTESTED'` to elevate their evidence. Trust levels are derived strictly by the server.
2. **HTTPS is NOT Attestation:** A TLS/HTTPS connection establishes transport encryption; it does NOT prove cryptographic non-repudiation or attestation of the underlying database/API payload.
3. **Simulated vs External:** Observations from simulated adapters include `'SIMULATED_OBSERVATION_SOURCE'` limitations. Real external reader observations carry `observerType: 'EXTERNAL'`.
