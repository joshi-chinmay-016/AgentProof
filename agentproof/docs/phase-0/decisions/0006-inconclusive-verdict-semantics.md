# ADR 0006: Tri-State Verdict Model and Inclusion of INCONCLUSIVE

**Status:** Approved  
**Date:** 2026-10-17  
**Deciders:** Principal Architect, Reliability Engineer  

---

## Context
Traditional binary evaluation systems classify outcomes as either `PASS` or `FAIL`. However, in distributed systems and real-world agent verification, observers frequently encounter network partitions, adapter timeouts, missing permissions, stale read replicas, or ambiguous specifications. Forcing these conditions into a binary `PASS` or `FAIL` creates catastrophic distortions in truth.

## Decision
We decide that **AgentProof mandates a strict Tri-State Verdict Model: `PASS`, `FAIL`, and `INCONCLUSIVE`.**

- `PASS`: Only when evidence affirmatively proves postconditions were satisfied.
- `FAIL`: Only when high-integrity evidence affirmatively proves postconditions were violated.
- `INCONCLUSIVE`: When evidence is missing, stale, corrupt, conflicted, or unreachable. Missing evidence must **NEVER** default to `FAIL` (false alarm) or `PASS` (dangerous blind trust).

## Alternatives Considered
1. **Binary Verdict (`PASS` / `FAIL`):**
   - *Pros:* Simpler logic.
   - *Cons:* If an observation timeout is treated as `FAIL`, engineers spend hours debugging non-existent agent errors when the database was simply lagging. If treated as `PASS`, unverified mutations pass unchecked.
2. **Binary Verdict with Boolean Error Flag (`FAIL`, `isError: true`):**
   - *Pros:* Keeps binary status.
   - *Cons:* Downstream consumers often inspect only the top-level status string, leading to misclassification of infrastructure hiccups as agent execution failures.

## Consequences
- **Positive:**
  - Epistemic integrity: the system never lies about what it knows vs what it could not observe.
  - Transparent error diagnostics via standardized reason codes (`INC_READER_TIMEOUT`, `INC_STALE_EVIDENCE`).
  - Clear guidance for orchestrators (e.g., orchestrators can retry an `INCONCLUSIVE` result without penalizing the agent).
- **Negative:**
  - Downstream consumers must handle three branches instead of two.

## Revisit Conditions
The tri-state model is a fundamental mathematical requirement of empirical verification and will not be reverted to binary.
