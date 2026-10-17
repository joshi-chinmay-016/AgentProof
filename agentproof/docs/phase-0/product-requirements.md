# AgentProof — Phase 0: Product Requirements Document (PRD)

**Document Version:** 1.0.0  
**Status:** Approved Specification  
**Author:** Software Architect & AI Agent Reliability Engineer  
**Scope:** Functional Requirements, Use Cases, Core Workflows, Non-Goals  

---

## 1. Problem Statement

Modern AI agents routinely execute complex, multi-step actions across external APIs, databases, filesystems, and operational tools. When an agent invokes a tool (e.g., `update_subscription`, `grant_permission`, `refund_charge`), it receives a response payload—frequently an HTTP `200 OK`, a JSON `{ "status": "success" }`, or a boolean `{ "acknowledged": true }`.

### The Verification Gap
In real-world distributed architectures, a tool's reported success does **not** equal operational reality. Critical failure modes include:
1. **Silent Swallowed Errors:** Tool wrappers that catch exceptions and return `{ success: true }` without applying changes.
2. **Mock or Test Double Divergence:** Execution targeting sandbox or mock instances while the agent claims production mutation.
3. **Uncommitted Transactions & Eventual Consistency:** Operations acknowledged in memory or on a message queue that subsequently fail reconciliation or rollback.
4. **Incorrect Resource Targeting:** The agent executes an update successfully, but targets the wrong tenant, organization, or record ID.
5. **Partial Mutation:** The tool modifies one attribute (e.g., status) but fails to apply the required associated mutations (e.g., quota limits).
6. **Agent Hallucination & Confirmation Bias:** Agents declare victory based on conversational reasoning or flawed intermediate tool feedback without inspecting ground-truth state.

**AgentProof** closes this verification gap by providing an independent, model-agnostic verification platform that evaluates whether an agent's claimed action is backed by empirical, independently observed postcondition evidence.

---

## 2. Target Persona & Stakeholders

The primary users of AgentProof are:
- **AI-Agent Platform Engineers:** Teams deploying autonomous or human-in-the-loop agents requiring deterministic safety gates before executing subsequent dependent workflow steps.
- **AI Reliability & QA Engineers:** Engineers establishing evaluation benchmarks, compliance audits, and regression suites to measure agent accuracy against real systems.
- **Enterprise Security & Compliance Officers:** Stakeholders requiring cryptographically verifiable audit trails that prove an agent's actions conformed strictly to authorization and business policies.

---

## 3. Initial Use Case: Controlled Record Mutation

The initial reference domain is **Customer Subscription Management**. This domain provides clear, unambiguous state transitions, strict business invariants, and well-defined failure modes.

### Domain Entities
- **Target Record:** Customer Subscription (`subscription_id: "sub_c791"`, `customer_id: "cust_102"`, `tier: "free"`, `status: "active"`, `max_seats: 1`).
- **Requested Change:** Upgrade tier from `"free"` to `"pro"`, increase `max_seats` to `10`.
- **Declared Expected Outcome:** Subscription record has `tier == "pro"`, `max_seats == 10`, `status == "active"`, and `updated_at > request_timestamp`.
- **Action Record:** The agent's invocation of `update_subscription` with status `"reported_success"`.
- **Independently Observable State:** Raw record read directly from the datastore or state provider via an isolated reader, completely separate from the agent's tool execution channel.
- **Verification Verdict:** Evidence-backed determination of `PASS`, `FAIL`, or `INCONCLUSIVE`.

---

## 4. MVP Capabilities

The initial version of AgentProof must deliver ten core capabilities:

1. **Structured Verification Request Definition:**
   - Formal schema to declare the target resource, expected state transitions, preconditions, postconditions, and evaluation strictness.
2. **Explicit Precondition Evaluation:**
   - Independent verification that initial state met prerequisite criteria prior to the action (e.g., verifying `tier == "free"` before confirming upgrade).
3. **Action Ingestion & Context Capture:**
   - Recording the agent's tool execution payload, claimed parameters, tool response, execution duration, and timestamp.
4. **Independent State Acquisition:**
   - State retrieval isolated from the agent's mutating tool context to prevent poisoned observations or compromised execution scopes.
5. **Deterministic Rule Evaluation:**
   - Type-safe, deterministic predicate engine that checks equality, numeric thresholds, membership, delta transitions, and non-empty conditions.
6. **Structured Tri-State Verdicts:**
   - Emitting an unambiguous verdict of `PASS`, `FAIL`, or `INCONCLUSIVE`, accompanied by reason codes and detailed diagnostics.
7. **Evidence & Provenance Binding:**
   - Linking every condition evaluation directly to timestamped, hash-verified evidence snapshots.
8. **Immutable Audit Trace Generation:**
   - Persisting an inspectable, re-playable `VerificationTrace` linking request, action, observations, rule outcomes, and final verdict.
9. **Controlled Benchmark Scenario Suite:**
   - Providing built-in scenarios with known ground truth (genuine success, false success, wrong target, partial update, reader failure).
10. **MCP Protocol Surface:**
    - Exposing verification and scenario execution capabilities via standard Model Context Protocol (MCP) tools for seamless integration with AI orchestrators and NitroStudio.

---

## 5. Non-Goals for the Initial Version

To ensure technical depth and architectural integrity without premature complexity, the following areas are strictly deferred:

- ❌ **General-Purpose Autonomous Execution:** AgentProof is an evaluation and verification layer, not an autonomous agent orchestrator or task planner.
- ❌ **Arbitrary Production System Mutation:** AgentProof will not perform unconstrained write operations against arbitrary production APIs.
- ❌ **Automated Remediation / Rollback:** AgentProof evaluates and reports ground truth; it does not attempt autonomous database recovery or self-healing rollbacks.
- ❌ **Mandatory LLM-as-a-Judge:** Core verification must be 100% deterministic, reproducible, and explainable without requiring probabilistic LLM inference. Optional LLM trace summarization is strictly secondary.
- ❌ **Heavy SaaS / Multi-Tenant Infrastructure:** No multi-tenant user authentication, Stripe billing, or organizational partitioning in the MVP.
- ❌ **Distributed Microservices & Queues:** No Kafka, RabbitMQ, Redis, or Kubernetes clusters. A modular monolith provides the highest reliability and testing velocity.
- ❌ **Production Database Dependencies:** No hard requirement for external PostgreSQL or Cloud SQL instances during initial development. Storage must operate against memory or local deterministic JSON fixtures with pluggable abstractions.

---

## 6. Primary User Journeys

### Journey 1: Misleading Success (False Positive Prevention)
```
[AI Agent]                     [AgentProof]                   [Target State]
    │                                │                              │
    ├─ 1. Calls update_subscription ─┼─────────────────────────────►│ (Fails silently /
    │     (returns {success: true})  │                              │  drops mutation)
    │                                │                              │
    ├─ 2. Calls verify_outcome ─────►│                              │
    │     (Target: sub_c791)         ├─ 3. Acquires state snapshot ─►│
    │                                │◄─ (Returns: tier="free") ────┤
    │                                │                              │
    │                                ├─ 4. Evaluates Postconditions:│
    │                                │     Expected: tier == "pro"  │
    │                                │     Observed: tier == "free" │
    │                                │     Outcome: FAILED          │
    │                                │                              │
    │◄─ 5. Returns Verdict: FAIL ────┤                              │
    │      Reason: ERR_VALUE_MISMATCH│                              │
    │      Evidence: StateSnapshot#1 │                              │
```
1. **Action:** An AI agent invokes `update_subscription(id="sub_c791", tier="pro")`.
2. **Claim:** The tool returns `{ "status": "success", "message": "Subscription updated" }`. The agent claims the subscription is now Pro.
3. **Verification Request:** The agent (or supervising workflow) submits a `verify_outcome` request specifying `target: sub_c791` and expected postcondition `tier == "pro"`.
4. **Independent Observation:** AgentProof queries the independent state reader for `sub_c791`.
5. **Evidence Check:** State reader observes that `tier` is still `"free"`.
6. **Verdict:** AgentProof issues a `FAIL` verdict with reason code `ERR_VALUE_MISMATCH`, highlighting that the agent's claim contradicts observable reality.

---

### Journey 2: Genuine Success (Evidence-Backed Assurance)
```
[AI Agent]                     [AgentProof]                   [Target State]
    │                                │                              │
    ├─ 1. Calls update_subscription ─┼─────────────────────────────►│ (Applies update:
    │     (returns {success: true})  │                              │  tier="pro",
    │                                │                              │  seats=10)
    ├─ 2. Calls verify_outcome ─────►│                              │
    │     (Target: sub_c791)         ├─ 3. Acquires state snapshot ─►│
    │                                │◄─ (Returns: tier="pro", ...) ┤
    │                                │                              │
    │                                ├─ 4. Evaluates Postconditions:│
    │                                │     tier == "pro" -> PASS    │
    │                                │     max_seats == 10 -> PASS  │
    │                                │     Outcome: ALL PASSED      │
    │                                │                              │
    │◄─ 5. Returns Verdict: PASS ────┤                              │
    │      Evidence: StateSnapshot#2 │                              │
    │      Trace ID: trc_8812        │                              │
```
1. **Action:** An AI agent invokes `update_subscription(id="sub_c791", tier="pro", seats=10)`.
2. **Claim:** The tool returns `{ "status": "success" }`.
3. **Verification Request:** AgentProof receives postconditions: `tier == "pro"`, `max_seats == 10`, `status == "active"`.
4. **Independent Observation:** AgentProof queries the state reader.
5. **Evidence Check:** Raw datastore snapshot confirms `tier == "pro"`, `max_seats == 10`, and `updated_at` reflects current transaction time.
6. **Verdict:** AgentProof issues a `PASS` verdict, returning the signed trace ID and evidence payload.

---

### Journey 3: State Reader Failure (Inconclusive Handling)
```
[AI Agent]                     [AgentProof]                   [Target State]
    │                                │                              │
    ├─ 1. Calls update_subscription ─┼─────────────────────────────►│ (State unknown)
    │     (returns {success: true})  │                              │
    │                                │                              │
    ├─ 2. Calls verify_outcome ─────►│                              │
    │     (Target: sub_c791)         ├─ 3. Queries state reader ────►[Timeout / Error]
    │                                │◄─ Connection Timeout ────────┤
    │                                │                              │
    │                                ├─ 4. Evaluates Evidence:      │
    │                                │     Evidence Missing/Corrupt │
    │                                │     Outcome: INCONCLUSIVE    │
    │                                │                              │
    │◄─ 5. Verdict: INCONCLUSIVE ────┤                              │
    │      Reason: INFRA_TIMEOUT     │                              │
```
1. **Action:** Tool executes and returns success.
2. **Observation:** State reader encounters network timeout or permission failure.
3. **Evaluation:** AgentProof detects that evidence is missing.
4. **Verdict:** AgentProof returns `INCONCLUSIVE` (reason `INFRA_TIMEOUT`). It **never** defaults to `PASS` or `FAIL` in the absence of valid evidence.
