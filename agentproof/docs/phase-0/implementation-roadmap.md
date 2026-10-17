# AgentProof — Phase 0: Implementation Roadmap

**Document Version:** 1.0.0  
**Status:** Approved Specification  
**Author:** Technical Lead & Engineering Manager  
**Scope:** 9-Phase Delivery Plan, Vertical Slice Definition, Acceptance Gates  

---

## 1. Executive Roadmap Overview

The implementation of AgentProof is structured into nine sequential, independently testable phases. Work proceeds from foundational developer tooling to domain core, deterministic simulation, MCP exposure, trace auditing, benchmarking, extensibility, and deployment.

```
┌────────────────────────────────────────────────────────┐
│ THE SMALLEST VERTICAL SLICE (Phases 1–4)               │
│                                                        │
│ Phase 1: Tooling & Vitest Setup                        │
│    │                                                   │
│    ▼                                                   │
│ Phase 2: Pure Domain Verification Engine (Core)        │
│    │                                                   │
│    ▼                                                   │
│ Phase 3: Simulated Record-Management Environment       │
│    │                                                   │
│    ▼                                                   │
│ Phase 4: End-to-End MCP Workflow (verify_outcome)      │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│ ADVANCED CAPABILITIES & HARDENING (Phases 5–9)         │
│                                                        │
│ Phase 5: Trace & Audit Subsystem (inspect_trace)       │
│ Phase 6: Benchmark Evaluation Suite (run_scenario)     │
│ Phase 7: Pluggable Extension Framework                 │
│ Phase 8: NitroStudio Demo & UI Widgets                 │
│ Phase 9: Research Paper, Hardening & Security Audits   │
└────────────────────────────────────────────────────────┘
```

---

## 2. Phase-by-Phase Execution Plan

### Phase 1 — NitroStack Foundation & Test Harness
- **Objectives:** Establish the developer environment, configure Vitest for automated testing without breaking NitroStack CLI, verify build and dev scripts.
- **Proposed Files:**
  - `agentproof/agentproof/vitest.config.ts`
  - `agentproof/agentproof/package.json` (add `test` script and `vitest` devDependency)
  - `agentproof/agentproof/tests/foundation.test.ts`
- **Dependencies:** None (builds on Phase 0 discovery).
- **Tasks:**
  1. Add `vitest` to `devDependencies`.
  2. Configure `vitest.config.ts` with ES Module support.
  3. Verify that `npm run build` and `npm test` execute cleanly.
- **Tests:** Basic smoke test validating that TypeScript compiles and tests execute.
- **Acceptance Criteria:** `npm test` runs and passes; `nitrostack-cli build` succeeds without warnings.
- **Non-Goals:** Writing domain verification logic.

---

### Phase 2 — Core Verification Engine
- **Objectives:** Implement the pure domain model, deterministic rule engine, predicate evaluators, and tri-state verdict aggregator.
- **Proposed Files:**
  - `src/core/contracts/domain.types.ts`
  - `src/core/contracts/verdict.types.ts`
  - `src/core/predicates/evaluator.ts`
  - `src/core/verification/rule-engine.ts`
  - `src/core/verification/verdict-aggregator.ts`
  - `tests/unit/rule-engine.test.ts`
  - `tests/unit/verdict-aggregator.test.ts`
- **Dependencies:** Phase 1.
- **Tasks:**
  1. Implement typed schemas for `VerificationRequest`, `ConditionSpec`, `Evidence`, `VerificationResult`.
  2. Implement pure predicate functions (`EQUALS`, `GREATER_THAN`, `CONTAINS`, `EXISTS`).
  3. Implement `VerdictAggregator` implementing the tri-state truth table.
- **Tests:** 10 deterministic unit test scenarios specified in `testing-and-evaluation.md`.
- **Acceptance Criteria:** 100% test pass rate on unit test scenarios; 0 external dependencies in `src/core`.
- **Non-Goals:** MCP integration, HTTP endpoints.

---

### Phase 3 — Simulated Environment & Action Harness
- **Objectives:** Build an isolated, deterministic in-memory record management store and action adapter with configurable success/failure injection.
- **Proposed Files:**
  - `src/adapters/state/memory-state.reader.ts`
  - `src/adapters/actions/memory-action.adapter.ts`
  - `src/domain/fixtures/subscription.fixture.ts`
  - `tests/integration/simulated-environment.test.ts`
- **Dependencies:** Phase 2.
- **Tasks:**
  1. Create in-memory subscription repository.
  2. Create test harness supporting modes: `GENUINE_SUCCESS`, `FALSE_SUCCESS`, `WRONG_TARGET`, `PARTIAL_UPDATE`.
- **Tests:** Assert that the harness accurately simulates silent failure and mutation drops.
- **Acceptance Criteria:** Simulated false-success updates leave underlying state unmodified and detectable by `IStateReader`.
- **Non-Goals:** Live database connections.

---

### Phase 4 — End-to-End MCP Workflow
- **Objectives:** Connect the core verification engine to NitroStack by exposing the `verify_outcome` MCP tool.
- **Proposed Files:**
  - `src/application/services/verification.service.ts`
  - `src/modules/verification/verification.module.ts`
  - `src/modules/verification/verification.tools.ts`
  - `src/modules/verification/schemas/verify-outcome.schema.ts`
  - `src/app.module.ts` (register VerificationModule)
  - `tests/integration/mcp-verify-outcome.test.ts`
- **Dependencies:** Phases 1–3.
- **Tasks:**
  1. Implement `VerificationService` orchestrating state read and rule check.
  2. Create `@Controller('verification')` and `@Tool('verify_outcome')`.
  3. Register module in `AppModule`.
- **Tests:** Integration tests verifying that tool invocation returns `PASS` for genuine updates and `FAIL` for false successes.
- **Acceptance Criteria:** MCP client (or test runner) calls `verify_outcome` and receives valid Zod-validated response.
- **Non-Goals:** Trace search, scenario execution tools.

---

### Phase 5 — Trace & Audit System
- **Objectives:** Implement immutable trace generation, cryptographic hashing (SHA-256), credential redaction, and the `inspect_trace` MCP tool.
- **Proposed Files:**
  - `src/application/services/trace.service.ts`
  - `src/adapters/storage/in-memory-trace.repo.ts`
  - `src/adapters/storage/file-trace.repo.ts`
  - `src/modules/verification/schemas/inspect-trace.schema.ts`
  - `tests/integration/trace-inspection.test.ts`
- **Dependencies:** Phase 4.
- **Tasks:**
  1. Implement SHA-256 hashing for evidence payloads.
  2. Implement secret sanitization pipe.
  3. Expose `inspect_trace` tool.
- **Tests:** Verify that replaying trace retrieval returns unchanged data; verify credentials are redacted.
- **Acceptance Criteria:** `inspect_trace` returns complete trace by ID; tamper checks pass.
- **Non-Goals:** SQL persistence.

---

### Phase 6 — Evaluation Benchmark Suite
- **Objectives:** Implement the benchmark scenario catalog, execution harness, and calculation of Precision/Recall/Inconclusive metrics.
- **Proposed Files:**
  - `src/application/services/evaluation.service.ts`
  - `src/modules/scenarios/scenarios.module.ts`
  - `src/modules/scenarios/scenarios.tools.ts`
  - `fixtures/scenarios/subscription-suite.json`
  - `tests/benchmark/benchmark-suite.test.ts`
- **Dependencies:** Phase 5.
- **Tasks:**
  1. Author benchmark fixtures (minimum 10 scenarios).
  2. Expose `list_scenarios` and `run_scenario` MCP tools.
  3. Compute confusion matrix and metric outputs.
- **Tests:** Full test execution of benchmark suite comparing AgentProof verdicts against ground truth.
- **Acceptance Criteria:** 100% agreement on known ground truth scenarios; confusion matrix reported.
- **Non-Goals:** Web dashboard.

---

### Phase 7 — Extension Framework
- **Objectives:** Standardize provider registries for `IStateReader` and `ITraceRepository` to allow third-party system verification.
- **Proposed Files:**
  - `src/adapters/state/state-reader.registry.ts`
  - `src/core/contracts/extension.interface.ts`
  - `tests/unit/extension-registry.test.ts`
- **Dependencies:** Phase 6.
- **Tasks:**
  1. Implement dynamic registration of state readers based on `target.system`.
  2. Add documentation for custom adapter authors.
- **Tests:** Dynamically register a mock REST API reader and execute verification through it.
- **Acceptance Criteria:** Custom readers can be registered without editing core domain files.
- **Non-Goals:** Writing proprietary vendor integrations.

---

### Phase 8 — Demo & Deployment Integration
- **Objectives:** Prepare end-to-end demonstration scripts for NitroStudio, configure dual transport (STDIO + HTTP SSE), and connect the Next.js widget for interactive visualization.
- **Proposed Files:**
  - `src/widgets/app/page.tsx` (verification status widget)
  - `scripts/demo-walkthrough.ts`
  - `docs/demo-guide.md`
- **Dependencies:** Phase 7.
- **Tasks:**
  1. Test server inside NitroStudio GUI.
  2. Link `@Widget('verification-verdict')` to React UI in `src/widgets`.
  3. Record demonstration walkthrough.
- **Acceptance Criteria:** Interactive verification cards appear in NitroStudio chat.
- **Non-Goals:** Multi-tenant cloud hosting.

---

### Phase 9 — Research, Hardening & Security Audit
- **Objectives:** Formalize research documentation, review threat model mitigations, benchmark latency overhead, and conduct fuzzing tests.
- **Proposed Files:**
  - `docs/research/paper-summary.md`
  - `docs/research/threat-mitigation-audit.md`
  - `tests/security/fuzzing.test.ts`
- **Dependencies:** Phase 8.
- **Tasks:**
  1. Execute fuzz testing with malformed payloads.
  2. Measure verification latency overhead under load.
  3. Document reproducible findings.
- **Acceptance Criteria:** Final research report completed with zero unresolved security findings.

---

## 3. The Smallest End-to-End Vertical Slice

To prove the core architectural thesis as early as possible, **Phases 1 through 4** constitute the Minimal Viable Vertical Slice:
1. Vitest test harness initialized (Phase 1).
2. Pure deterministic rule engine (Phase 2).
3. Simulated subscription false-success environment (Phase 3).
4. `verify_outcome` tool running via NitroStack MCP (Phase 4).

Completion of this slice proves end-to-end that an agent's false success claim can be caught and flagged with an evidence-backed `FAIL` verdict.
