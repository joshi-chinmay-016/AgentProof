# ADR-011: Source Conflict and Freshness Resolution

## Status
Accepted

## Context
When multiple independent external state readers observe the same resource, observations may conflict (e.g., regional replicas before replication lag resolves, or caching inconsistencies). Furthermore, observations may be stale relative to the agent's action timestamp.

## Decision
1. **Deterministic Conflict Handling:** If two independent sources return contradictory values for the same condition path, `ConditionEvaluator` returns `INCONCLUSIVE` with reason code `INC_CONFLICTING_EVIDENCE`. LLMs or heuristic guesses are never permitted to resolve data conflicts.
2. **Freshness Invariant:** If an evidence item's `observedAt` timestamp precedes the action invocation by more than the configured `freshnessToleranceMs`, the evidence is marked stale and evaluated as `INCONCLUSIVE` (`INC_STALE_EVIDENCE`).
3. **Future Skew Invariant:** Observations with future timestamps exceeding allowable clock skew (default 10,000ms) are rejected as invalid and produce `INCONCLUSIVE` (`INC_UNTRUSTED_EVIDENCE`).

## Consequences
- Guarantees deterministic, mathematically explainable outcomes under distributed race conditions.
- Prevents stale or pre-action cache hits from producing false verification passes.
