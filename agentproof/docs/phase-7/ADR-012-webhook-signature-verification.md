# ADR-012: Webhook Signature Verification

## Status
Accepted

## Context
External webhooks arrive over untrusted networks. Without cryptographic verification, malicious actors could forge webhook payloads claiming that agent operations succeeded or inject unauthorized state updates into AgentProof. Furthermore, re-serializing JSON prior to verification alters whitespace, key ordering, and string escapes, invalidating cryptographic signatures.

## Decision
1. **Raw Byte Verification:** All webhook signatures must be computed and verified directly over the unparsed raw request buffer (`Buffer`) before any JSON parsing or reserialization.
2. **Supported Schemes:**
   - **HMAC-SHA256:** Supports standard hex digests, GitHub `sha256=` prefixes, and Stripe `t=<timestamp>,v1=<signature>` schemes.
   - **RSA-SHA256:** Supports asymmetric signatures verified against pre-registered server-side public keys. Caller-supplied public keys are strictly rejected.
3. **Constant-Time Comparison:** Signatures are compared using Node's `crypto.timingSafeEqual` to prevent side-channel timing attacks. Length mismatches short-circuit safely.
4. **Fail-Closed Gate:** If signature verification fails or if signing secrets are missing, the request is immediately rejected with HTTP `401 Unauthorized` and never enters the event pipeline.

## Consequences
- Eliminates webhook forgery and timing side-channel attacks.
- Preserves signature validity across different JSON formatting variations.
- Protects downstream processing resources from unauthenticated traffic.
