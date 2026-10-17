# AgentProof — Phase 0: Verification Semantics Specification

**Document Version:** 1.0.0  
**Status:** Approved Specification  
**Author:** Software Architect & Reliability Engineering Lead  
**Scope:** Verdict Definitions, Failure Taxonomy, Multi-Condition Aggregation, Reason Codes  

---

## 1. Principles of Verification

AgentProof operates on the foundational principle of **epistemic honesty**:
1. **Tool Output is an Unverified Assertion:** An agent tool returning `{ "success": true }` is an unverified claim, not empirical proof.
2. **Evidence Requires Independence:** Proof must originate from an independent observation channel isolated from the agent's mutating tool context.
3. **Absence of Proof is Not Proof of Absence:** Missing or unreachable evidence does not imply that an action failed; it implies that the outcome is unknown.
4. **Deterministic Authority:** Truth is determined through deterministic predicates evaluated against observable state, never via probabilistic LLM confidence scoring.

---

## 2. Tri-State Verdict Definitions

Every verification evaluation culminates in one of three mutually exclusive verdicts:

```
┌──────────────────────────────────────────────────────────────────┐
│                   VERIFICATION VERDICT SPACE                     │
├─────────────────┬─────────────────┬──────────────────────────────┤
│      PASS       │      FAIL       │         INCONCLUSIVE         │
├─────────────────┼─────────────────┼──────────────────────────────┤
│ Required        │ Reliable        │ Evidence is missing, stale,  │
│ postconditions  │ evidence proves │ corrupt, conflicted, or      │
│ proven satisfied│ postconditions  │ unreadable due to            │
│ by evidence.    │ violated.       │ infrastructure errors.       │
└─────────────────┴─────────────────┴──────────────────────────────┘
```

### 2.1 PASS
**Definition:** All required postconditions are satisfied by relevant, fresh, and trusted evidence obtained from an independent observation source.

**Strict Criteria for PASS:**
- The independent observation was successfully retrieved.
- The observation timestamp falls within the allowable freshness window relative to the action invocation.
- All declared required postconditions evaluated to `true`.
- No system invariant was violated.
- *Negative Constraint:* A tool claiming success while state is unread or unverifiable can **never** yield a PASS.

### 2.2 FAIL
**Definition:** High-integrity, reliable evidence establishes that at least one required postcondition was violated, or the observed post-action state directly contradicts the expected outcome.

**Strict Criteria for FAIL:**
- The independent observation was successfully retrieved with verified integrity.
- The evidence is fresh and relevant to the target resource.
- The observed values conclusively violate the asserted postconditions (e.g., expected `tier == "pro"`, but observed `tier == "free"`).
- *Negative Constraint:* A failed connection to a state reader or an empty response does **not** yield FAIL. It must yield INCONCLUSIVE.

### 2.3 INCONCLUSIVE
**Definition:** The verifier cannot establish whether the action succeeded or failed because the required evidence is insufficient, ambiguous, inaccessible, or contradictory.

**Exhaustive Triggers for INCONCLUSIVE:**
1. **State Reader Unavailable:** Network timeout, connection refused, or crash of the observation adapter.
2. **Access & Permissions Denied:** The observation provider lacks credentials to inspect the target resource.
3. **Stale Evidence:** The newest available observation is older than the action invocation timestamp (indicating an un-replicated or cached read).
4. **Incomplete / Opaque State:** The datastore does not expose the attributes needed to evaluate the postcondition.
5. **Conflicting Observations:** Two independent observation sources return contradictory values for the same resource without a deterministic reconciliation rule.
6. **Ambiguous Specification:** The verification request did not supply adequate parameters to form an evaluatable predicate.

---

## 3. Failure & Status Taxonomy

To eliminate ambiguity across agent workflows, AgentProof distinguishes between five distinct operational conditions:

| Category | Description | AgentProof Interpretation |
| :--- | :--- | :--- |
| **Failed Execution** | The agent's tool threw an error, returned HTTP 500, or explicitly reported `{ success: false }`. | The action execution itself aborted before completion. Preconditions and postconditions may not even be reached. |
| **Failed Postcondition** | The tool claimed success, but independent observation reveals that the target state did not transition as specified. | A **real failure** (semantic violation or false positive). Yields **FAIL**. |
| **Verification Infrastructure Failure** | AgentProof or its state readers experienced network partitions, timeouts, or adapter faults. | An infrastructure limitation. Yields **INCONCLUSIVE** with an infrastructure reason code. |
| **Insufficient Evidence** | The target system does not log or persist state snapshots needed to prove the claim. | Epistemic limit of the target environment. Yields **INCONCLUSIVE**. |
| **Conflicting Observations** | Primary replica returns state $A$, while secondary replica returns state $B$. | Replication lag or split-brain. Yields **INCONCLUSIVE** until consistency is attained. |

---

## 4. Multi-Condition Evaluation & Aggregation Rules

A verification request typically asserts multiple conditions:
- **Preconditions:** Assertions on state prior to the action.
- **Postconditions:** Assertions on state following the action.
- **Invariants:** Global safety conditions that must remain true throughout.

### 4.1 Condition Classification
Each condition possesses an **Enforcement Level**:
- **`REQUIRED` (Default):** Failure of this condition invalidates the verification.
- **`ADVISORY`:** Evaluated for telemetry and diagnostics, but failure does not downgrade an overall `PASS`.

### 4.2 Aggregation Logic
AgentProof evaluates all conditions exhaustively (no premature short-circuiting) to provide full diagnostic transparency.

The aggregation truth table for overall verdict calculation across all `REQUIRED` conditions is strictly defined:

| Any Condition FAIL? | Any Condition INCONCLUSIVE? | All Conditions PASS? | Aggregated Overall Verdict |
| :---: | :---: | :---: | :---: |
| **YES** | *Any* | *Any* | **`FAIL`** |
| **NO** | **YES** | *Any* | **`INCONCLUSIVE`** |
| **NO** | **NO** | **YES** | **`PASS`** |

> [!IMPORTANT]
> **Priority Hierarchy:**
> `FAIL` takes absolute precedence over `INCONCLUSIVE`, which takes precedence over `PASS`.
> If even one required postcondition is proven violated by valid evidence, the overall verdict is `FAIL` regardless of whether another condition was inconclusive.

---

## 5. Standard Reason Codes

All condition evaluations and aggregated results must include a standardized, machine-readable reason code:

### 5.1 Success Reason Codes
- `PASS_ALL_CONDITIONS_VERIFIED`: Every declared postcondition was confirmed against independent state.
- `PASS_DELTA_MATCHED`: Explicit state transition matched mathematical or logical delta.

### 5.2 Failure Reason Codes (FAIL)
- `FAIL_VALUE_MISMATCH`: Observed attribute value did not equal expected value.
- `FAIL_THRESHOLD_EXCEEDED`: Numeric metric was outside allowable bounds.
- `FAIL_TARGET_NOT_MODIFIED`: Target resource timestamp was not updated; state remained in pre-action state.
- `FAIL_WRONG_RESOURCE_MODIFIED`: Mutation occurred on an unexpected resource or tenant ID.
- `FAIL_INVARIANT_VIOLATED`: Safety invariant (e.g., account balance $\ge 0$) was broken.
- `FAIL_PRECONDITION_VIOLATED`: Initial state did not permit the action to take place.

### 5.3 Inconclusive Reason Codes (INCONCLUSIVE)
- `INC_READER_TIMEOUT`: State provider timed out while retrieving observation.
- `INC_READER_ERROR`: Observation provider threw an unexpected runtime exception.
- `INC_STALE_EVIDENCE`: Observation timestamp precedes the action invocation timestamp.
- `INC_MISSING_ATTRIBUTES`: Observed object lacked fields required to evaluate condition.
- `INC_CONFLICTING_EVIDENCE`: Multiple observation sources disagree on resource state.
- `INC_UNSUPPORTED_PREDICATE`: Verification engine could not evaluate requested operator.

---

## 6. Rejection of Pseudo-Confidence Scores

AgentProof deliberately **rejects** the generation of arbitrary probabilistic confidence scores (e.g., `"Confidence: 94%"` or `"Verdict: PASS (0.87)"`) for the following architectural reasons:

1. **Unverifiable Heuristics:** LLM-generated confidence percentages are uncalibrated self-assessments that frequently suffer from overconfidence hallucinations.
2. **False Sense of Security:** A system reporting "85% confidence" gives no actionable guarantee to an engineer deciding whether to trigger a downstream financial transaction.
3. **Binary Ground Truth:** In formal verification and state inspection, a database record either has `status == "active"` or it does not. Applying a floating-point probability obscures deterministic reality.
4. **Principled Tri-State Model:** When certainty is impaired, the mathematically honest response is `INCONCLUSIVE`, backed by specific reason codes and evidence timestamps.
