# ADR-008: External State Reader Abstraction

## Status
Accepted

## Context
AgentProof was previously limited to simulated state observations in Phase 3. In Phase 6, AgentProof must independently observe real production systems (REST APIs, databases, object stores) without trusting AI agent outcome claims. We must define a common contract that represents ground-truth observations while preserving deterministic verification and multi-tenant isolation.

## Decision
1. Introduce `IExternalStateReader` with typed `ExternalObservationRecord` output.
2. Define a strict 4-state observation taxonomy: `FOUND`, `NOT_FOUND`, `READ_ERROR`, and `UNTRUSTED`.
3. Mandate that `readState()` operations are strictly read-only and never mutate observed systems.
4. Establish that network failures, timeouts, and authorization rejections are `READ_ERROR` and must NEVER be treated as confirmed absence (`NOT_FOUND`).
5. Map `ExternalObservationRecord` into the existing `Evidence` domain model via `ExternalEvidenceAdapter` with SHA-256 canonical hashing.

## Consequences
- The core verification engine remains framework-independent and side-effect free.
- Observation failures reliably produce INCONCLUSIVE verdicts rather than false PASS or false FAIL verdicts.
- All external observation sources integrate seamlessly into durable trace persistence.
