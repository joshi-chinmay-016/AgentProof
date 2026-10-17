# ADR-007: Evidence Provenance & Trust Classification Model

## Status
Accepted

## Context
A cryptographic hash (`integrityHash`) only proves that a payload matches a digest under a canonical serialization scheme; it does not prove who observed the state, whether the observation was genuine, or whether it was fresh. Callers could also fabricate evidence and assert false trust claims.

## Decision
1. Separate payload integrity (digest match) from evidence authenticity (trusted observer identity and cryptographic attestation).
2. Define four explicit evidence trust levels: `UNVERIFIED`, `INTEGRITY_CHECKED`, `SOURCE_AUTHENTICATED`, and `ATTESTED`.
3. Implement `EvidenceTrustValidator` to derive trust levels objectively:
   - Callers cannot self-elevate trust; caller-asserted `trustLevel` strings are ignored.
   - Trusted source registry matching assigns `SOURCE_AUTHENTICATED`.
   - Cryptographic RSA/ECDSA attestation signatures verified with public keys assign `ATTESTED`.
4. Enforce freshness tolerances and reject future timestamps exceeding clock skew limits (`FUTURE_TIMESTAMP_EXCEEDS_CLOCK_SKEW`).
5. Directly link evidence trust to the deterministic tri-state engine: untrusted or corrupted evidence yields `INCONCLUSIVE` (`INC_UNTRUSTED_EVIDENCE`), never a false `PASS` or false `FAIL`.

## Consequences
- AI agents cannot forge evidence trust levels.
- Verification verdicts reflect only trustworthy, verified evidence.
- Simulated sources are clearly labeled as simulated observations.
