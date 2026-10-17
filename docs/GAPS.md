# AgentProof — System Capabilities & Architectural Gaps (Phase 8)

> **Document Classification:** Engineering Observability & Gap Inventory  
> **Repository:** `agentproof`  
> **Status:** Authoritative  
> **Version:** 1.0.0 (Phase 8 Console Release)

---

## 1. Overview & Verification Philosophy

AgentProof is an independent postcondition verification layer for AI agents. Its fundamental premise is that **an agent's self-declaration can never be accepted as evidence of its own execution outcome**.

To uphold this guarantee, the AgentProof Web Console adheres to non-negotiable architectural invariants:
1. **Verdicts are authoritative and strictly tri-state:** `PASS`, `FAIL`, `INCONCLUSIVE`. The frontend never computes, overrides, or infers verdicts.
2. **Deterministic Aggregation Precedence:** `FAIL > INCONCLUSIVE > PASS`. If any postcondition is violated by reliable evidence, the outcome is `FAIL`. If any postcondition cannot be observed and none fail, the outcome is `INCONCLUSIVE`.
3. **Missing evidence is never success:** Inability to independently verify state is never rendered as failure (`INCONCLUSIVE` != `FAIL`).
4. **Observation statuses are evidence read states, not verdicts:** `FOUND`, `NOT_FOUND`, `READ_ERROR`, and `UNTRUSTED` represent observation reads, displayed with distinct visual components.
5. **Simulations are always visibly labeled:** Simulations (`SCENARIO_A` through `SCENARIO_H`) carry a prominent `[SIMULATION]` badge and are never presented as real production observations.
6. **Zero secret leakage:** Tenant secrets, credentials, and raw connection strings never reach the browser; references are masked (e.g., `vault://...`, `env://...`) and scoped server-side.

---

## 2. Implemented Capabilities vs. Known Gaps

| Subsystem / Capability | Production Implementation Status | UI Representation | Known Limitation / Gap |
| :--- | :--- | :--- | :--- |
| **Verification Engine** | Complete, deterministic (`VerificationEngine`) | Authoritative Verdict Badge, postcondition evaluation diffs | Does not perform fuzzy or probabilistic inference by design; exact predicates only. |
| **Postcondition Contracts** | Complete (`EQUALS`, `NOT_EQUALS`, `GREATER_THAN`, `LESS_THAN`, `CONTAINS`) | Expected vs Observed Diff Viewer with code highlighting | Custom user-defined regex predicates require backend validation rules. |
| **PostgreSQL Reader** | Complete (`PostgresStateReader`) with parameter binding | Reader inventory card, status `HEALTHY` or `DEGRADED` | Live database daemon required for external reads; returns `READ_ERROR` when unconfigured. |
| **AWS S3 State Reader** | Complete (`S3ObjectStateReader`) with ETag & metadata inspection | Reader inventory card, status `HEALTHY` or `DEGRADED` | Live AWS credentials required for production cloud buckets; local simulations use memory adapters. |
| **REST API State Reader** | Complete (`RestApiStateReader`) with URL allowlists and timeout protection | Reader inventory card, status `HEALTHY` | Untrusted external endpoints blocked by URL security policy. |
| **Webhook Ingestion** | Complete (`WebhookReceiverService`) with HMAC-SHA256 & RSA-SHA256 | Inbound event table, lifecycle states, signature pills | High-volume deduplication uses sliding window memory cache; multi-region sync requires distributed cache. |
| **Cryptographic Audit Chain** | Complete (`AuditChainService`) with SHA-256 block linking | Tri-state integrity badge (`Verified`, `Integrity Failed`, `Unable to Verify`) | Local hash chain protects against mid-chain modifications, but requires signed checkpoints against full rewrites. |
| **Signed Checkpoints** | Complete (`CheckpointService`) with RSA-SHA256 asymmetric signing | Checkpoints counter, sequence tracking, manual checkpoint creation | Checkpoint distribution across federated clusters is planned for Phase 9. |
| **MCP STDIO Protocol** | Complete with NitroStack decorators (`verify_outcome`, `inspect_trace`, `run_scenario`, `list_scenarios`) | Console does not interfere with STDIO; uses clean HTTP port | MCP STDIO transport is unbuffered and unpolluted; HTTP console runs on isolated port 3000. |
| **Tenant Isolation** | Complete via `x-agentproof-tenant` HTTP header and server-side scoping | Current tenant pill in sidebar, isolated run lists and metrics | Cross-tenant administrative aggregation requires root superadmin privileges. |
| **Signature 3D Visualization** | Complete via Three.js WebGL with photon animation and mouse rotation | Canvas container with capped DPR (`1.5`) and pause on hidden | Automatically falls back to high-fidelity 2D SVG on headless environments or when "Reduce Visuals" is active. |

---

## 3. Explicit Gap Inventory

### GAP-01: Live External Service Credentials in Development
- **Status:** Handled via Safe Degradation.
- **Description:** When running locally without live PostgreSQL connection strings or AWS credentials, external readers return observation state `READ_ERROR`.
- **System Behavior:** The verification engine treats `READ_ERROR` as inability to observe ground truth, resulting in an authoritative `INCONCLUSIVE` verdict. The console displays an amber `INCONCLUSIVE` badge and clearly labels the error in the detail drawer rather than fabricating test data.

### GAP-02: In-Browser Dynamic Reader Provisioning
- **Status:** Restricted by Design for Security.
- **Description:** Users cannot submit arbitrary connection strings or AWS secret keys via the browser console.
- **System Behavior:** Reader configurations are managed server-side or via infrastructure configuration. Secret references are returned as masked URIs (`vault://...`, `env://...`) to prevent credential exfiltration.

### GAP-03: Multi-Region Distributed Consensus
- **Status:** Planned for Phase 9.
- **Description:** Checkpoint signatures are currently generated by the designated tenant authority key in the local environment.
- **System Behavior:** Signed checkpoints verify against entire-history rewrites locally. Cross-organization multi-party notarization (e.g. transparency logs or BFT clusters) is scheduled for future federated releases.

### GAP-04: WebGL Hardware Availability on Headless CI
- **Status:** Handled via 2D SVG Fallback & Accessible Alternative.
- **Description:** Environments lacking GPU hardware acceleration (e.g., CI runners, low-powered terminals) cannot initialize Three.js WebGL contexts.
- **System Behavior:** The console detects WebGL availability and seamlessly switches to a 2D SVG pipeline with animated pulse indicators and accessible `.sr-only` screen-reader text. Users can manually toggle 2D/3D via the "Reduce Visuals" button.

---

## 4. Verification and Enforcement

Every capability claimed in this document is verified by automated regression test suites:
- **Core Tests:** `npm test` runs 288 tests across 43 test suites.
- **Protocol Tests:** `scripts/protocol-smoke-test.mjs` verifies genuine MCP STDIO protocol frames.
- **Console Tests:** `scripts/console-smoke-test.mjs` verifies HTTP API endpoints, audit integrity, and SPA assets.
