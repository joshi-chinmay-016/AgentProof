# AgentProof Phase 8: Web Console & Production Readiness

## Executive Overview

**AgentProof Phase 8** delivers a production-quality, premium web console that makes AgentProof's independent AI postcondition verification capabilities understandable, observable, and directly usable by AI engineers, security teams, and platform operators.

AgentProof is an independent verification layer for AI agents and tool-using systems. An agent saying "success" does not prove that the intended state changed. AgentProof evaluates explicit postconditions against independently observable evidence. Phase 8 provides the developer security console to explore, inspect, and monitor this verification layer.

---

## Key Capabilities Implemented in Phase 8

### 1. Operational Overview Dashboard (`/overview` or `/`)
- **Real-Time Verification KPI Metrics**: Total runs, PASS count & percentage, FAIL count & percentage, INCONCLUSIVE count & percentage, and Evidence Completeness Rate.
- **Authoritative Verdict Distribution**: Compact, interactive SVG donut chart with hover tooltips and drill-down links to filtered verifications.
- **Actionable Attention Section**: Surfaces recent verification failures (`FAIL`), inconclusive runs with missing observations (`INCONCLUSIVE`), and audit chain warnings with one-click direct investigation.
- **Subsystem & Connectivity Status**: Health indicators for PostgreSQL, AWS S3, REST API readers, webhook ingest, and audit hash-chain integrity.
- **Recent Verification Activity**: Live chronological ledger of deterministic evaluations with quick drawer inspection.

### 2. Verification Explorer (`/verifications`)
- **Filterable & Searchable Verification Ledger**: Search by trace ID, request ID, operation, system, or resource ID.
- **Status Filtering**: One-click filter pills for `ALL`, `PASS`, `FAIL`, and `INCONCLUSIVE`.
- **Detail Drawer / Inspector**:
  - Authoritative verdict badge and execution duration.
  - Transparent verdict explanation directly from `VerificationEngine`.
  - Required postconditions breakdown: path, operator, expected value, observed value from evidence, and evaluation result.
  - Supporting independent evidence manifest: source ID, source kind (`DIRECT_READ`, `REPLICA_READ`), freshness, SHA-256 integrity hash, and provenance trust level (`DIRECT_READ`, `INTEGRITY_CHECKED`, `ATTESTED`).
  - Raw Trace JSON viewer with syntax highlighting and one-click copy.
- **Guided "Run Verification" Workflow**: Safe execution modal allowing engineers to test postcondition verification against mock or real evidence.

### 3. Evidence & Cryptographic Audit Explorer (`/evidence-audit`)
- **Interactive Verification Pipeline Visualization**:
  - `[Claimed Action]` ➔ `[Required Postconditions]` ➔ `[Independent Evidence]` ➔ `[Deterministic Verdict]`
  - Clickable stages explaining how AgentProof transforms unverified agent claims into cryptographic proof.
- **Tamper-Evident Audit Chain Verifier**:
  - Runs live `AuditChainVerifier.verifyChain(events, tenantId)` over append-only audit event chains.
  - Displays verified sequence count, chain head digest, and broken links if detected.
  - **Signed RSA Checkpoint Manager**: Creates and verifies asymmetric RSA-SHA256 signed checkpoints of audit chain heads, protecting against entire-history rewrites or rollback attacks.
- **Independent Evidence Registry**: Formatted JSON evidence viewer with SHA-256 digests and observation metadata.
- **Trace & Event Timeline**: Chronological lifecycle trail of webhooks received, signatures verified, evidence retrieved, and audit events appended.

### 4. Integrations & Webhook Ingest Explorer (`/integrations-webhooks`)
- **Integration Inventory**: Live inventory of configured external state readers (PostgreSQL, AWS S3, REST API) with connectivity status and safe secret references (`vault://...`, `env://...`).
- **Inbound Webhook Stream**: Filterable list of incoming webhook records with signature verification status (`VALID`, `INVALID`, `REPLAY_ATTACK`), processing lifecycle state (`QUEUED`, `PROCESSING`, `COMPLETED`, `QUARANTINED`), and payload digests.
- **Secret Redaction**: Passwords, tokens, connection strings, and webhook signing secrets are stripped/masked before sending to the browser.

### 5. Scenario Library & Guided First-Run (`/scenarios`)
- **First-Run Onboarding Experience**: Plain-language explanation of AgentProof's 4-step independent verification model for new developers.
- **Scenario Catalog**: Complete discovery of simulation scenarios (`SCENARIO_A` through `SCENARIO_H`), including genuine success, false success (silent failure), wrong target, observation unavailable, and tenant isolation.
- **Interactive Scenario Execution**: One-click execution through backend `ScenarioRunner`, live progress feedback, and authoritative verdict display.

---

## Architectural Boundaries & Security Guarantees

1. **MCP STDIO Transport Isolation**: The MCP server uses `process.stdin` and `process.stdout`. The browser console server runs strictly over HTTP (port 3000) and never writes logs to `stdout` in STDIO mode.
2. **Authoritative Verdict Invariant**: The frontend never invents, infers, or recalculates authoritative verdicts. All outcomes (`PASS`, `FAIL`, `INCONCLUSIVE`) are deterministically computed by `VerificationEngine`.
3. **Tenant Boundary Enforcement**: All API routes enforce `x-agentproof-tenant` header scoping (defaulting to authorized tenant, rejecting cross-tenant inspection).
4. **Secret Redaction**: Passwords, bearer tokens, connection strings, and webhook signing secrets are masked before reaching the browser.
5. **Tamper-Evident Security**: Explains the critical distinction between local hash chains (which detect mid-chain tampering) and signed checkpoints (which detect full-history rollback/rewrite attacks).

---

## Quickstart & Commands

```bash
# 1. Build the production bundle
npm run build

# 2. Run all unit and integration tests (288 tests)
npm test

# 3. Start the Web Console HTTP Server
npm run start:console
# Or directly: node dist/server/run-console.js

# 4. Open the Web Console in your browser
# Navigate to: http://localhost:3000
```
