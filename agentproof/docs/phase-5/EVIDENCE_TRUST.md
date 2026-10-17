# AgentProof — Evidence Provenance & Trust Model

## 1. Core Principle: Integrity vs. Authenticity

A cryptographic hash (`integrityHash`) proves that a payload matches a digest under a canonical serialization scheme. However, payload integrity alone **does not prove**:
- Who created or observed the state.
- Whether the observation was fresh or replayed.
- Whether the observer had authority to access the system of record.
- Whether the underlying system was genuine or simulated.

AgentProof explicitly distinguishes **Payload Integrity** from **Evidence Authenticity**.

---

## 2. Evidence Trust Levels

Evidence items are classified into four hierarchical trust levels:

| Trust Level | Definition | Derivation Mechanism |
|---|---|---|
| `UNVERIFIED` | Raw evidence provided without verified digest or with validation errors | Default state if digest does not match payload |
| `INTEGRITY_CHECKED` | Digest matches deterministic canonical SHA-256 serialization of the observed payload | Payload canonicalized and re-hashed by `EvidenceTrustValidator` |
| `SOURCE_AUTHENTICATED` | Payload integrity verified AND observer identity matches a known, trusted source | Source ID verified against `TrustedSourceConfig.trustedSourceIds` |
| `ATTESTED` | Payload integrity verified AND signed cryptographically by an authoritative observer key | Cryptographic RSA/ECDSA signature verified against registered public key |

### Anti-Self-Elevation Guarantee
A caller cannot elevate its own trust level by passing `provenance.trustLevel = 'ATTESTED'` or `SOURCE_AUTHENTICATED`. The `EvidenceTrustValidator` ignores caller-asserted trust levels and derives the genuine level exclusively from validated digests, trusted registry matching, and cryptographic signature verification.

---

## 3. Freshness & Clock Skew Policy

1. **Maximum Clock Skew:** `observedAt` timestamps are verified against system time. Observations with future timestamps beyond `maxClockSkewMs` (default `10,000 ms`) are rejected with `FUTURE_TIMESTAMP_EXCEEDS_CLOCK_SKEW`.
2. **Action-Relative Freshness:** When an `ActionRecord` is provided, observations occurring prior to `action.invokedAt - policy.freshnessToleranceMs` are tagged with `STALE_EVIDENCE`.
3. **Simulated State Labeling:** Observations originating from simulation components are explicitly annotated with `SIMULATED_OBSERVATION_SOURCE` to prevent confusing simulation tests with real-world observations.

---

## 4. Integration with Deterministic Tri-State Logic

Evidence trust directly determines condition evaluation outcomes:

- **PASS:** Can ONLY be granted when all required conditions are satisfied by valid, fresh, non-corrupted evidence.
- **FAIL:** Granted when reliable, trustworthy evidence demonstrates a required postcondition is violated.
- **INCONCLUSIVE:** Granted when evidence is missing, conflicting, stale, or untrusted (`INC_UNTRUSTED_EVIDENCE`).

**Critical Invariant:** Invalid or corrupted evidence **never** produces a false PASS, and an observation failure does **never** produce a false FAIL if the true state remains unknown.
