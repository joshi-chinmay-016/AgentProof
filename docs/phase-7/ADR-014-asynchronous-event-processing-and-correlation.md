# ADR-014: Asynchronous Event Processing & Correlation

## Status
Accepted

## Context
Executing full ground-truth observation, database queries, and condition evaluations inside the synchronous HTTP webhook request handler risks request timeouts, resource exhaustion, and HTTP receiver unresponsiveness. Furthermore, incoming events do not automatically map to ground truth: an event claiming `success: true` must be correlated with an expected postcondition and optionally verified against real external state.

## Decision
1. **Decoupled Architecture:**
   - **Ingestion Boundary:** `WebhookReceiver` validates signatures and freshness, durably accepts the event as `QUEUED`, and immediately acknowledges with HTTP `202 Accepted`.
   - **Processing Boundary:** `WebhookEventProcessor` consumes events asynchronously, manages state transitions, invokes correlation, and executes the deterministic engine.
2. **Tenant-Scoped Correlation:**
   - Events are matched to pending verification requests registered in `IPendingRequestRegistry`.
   - Candidate IDs are matched via configured property paths (`source.correlationRule.correlationIdField`), standard paths (`requestId`, `correlationId`), or target resource binding `(resourceType, resourceId)`.
   - Correlation across tenants is strictly prohibited.
3. **Ambiguity and Unmatched Policy:**
   - Multiple candidate matches produce `AMBIGUOUS` and fail permanently to prevent incorrect verdicts.
   - Unmatched events are recorded and completed as `UNMATCHED`. AgentProof **never** invents or manufactures a verification request or postconditions from an unprompted webhook.
4. **Independent Observation Gate:**
   - If required by policy (`autoVerifyState` or `requireIndependentSource`), a Phase 6 state reader is invoked.
   - External observation errors produce `INCONCLUSIVE`, never `FAIL`.

## Consequences
- Protects the HTTP receiver from slow downstream systems.
- Ensures verification requests cannot be forged or synthesized by external senders.
- Preserves the deterministic verification tri-state semantics (`PASS`, `FAIL`, `INCONCLUSIVE`).
