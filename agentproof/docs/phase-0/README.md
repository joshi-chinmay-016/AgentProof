# AgentProof — Phase 0: Requirements, Architecture & Technical Design

**Status:** Completed & Approved  
**Date:** 2026-10-17  
**Author:** Software Architect & AI Agent Reliability Engineering Lead  

---

## 1. Executive Summary

Phase 0 establishes the technical foundations, product specifications, formal verification semantics, domain contracts, modular architecture, MCP tool schemas, security threat models, and testing benchmarks for **AgentProof**—an extensible, model-independent verification platform for AI agents.

AgentProof addresses the **Verification Gap**: the reality that an AI agent's tool reporting `{ "status": "success" }` does not guarantee that the intended outcome occurred in ground truth. By independently acquiring state and evaluating typed deterministic postconditions, AgentProof provides empirical proof of whether an agent's claimed action genuinely succeeded (`PASS`), failed (`FAIL`), or lacks sufficient evidence (`INCONCLUSIVE`).

---

## 2. Phase 0 Deliverable Index

All technical specifications have been authored and organized into the following document suite:

| Document | Workstream | Description |
| :--- | :--- | :--- |
| **[repository-discovery.md](file:///c:/agentproof/agentproof/docs/phase-0/repository-discovery.md)** | Workstream A | Factual inventory of Git root (`c:\agentproof`), application root (`c:\agentproof\agentproof`), dependencies, NitroStack decorators, scripts, and runtime conventions. |
| **[product-requirements.md](file:///c:/agentproof/agentproof/docs/phase-0/product-requirements.md)** | Workstream B | Problem statement, primary personas, subscription update reference use case, 10 MVP capabilities, explicit non-goals, and detailed user journeys. |
| **[verification-semantics.md](file:///c:/agentproof/agentproof/docs/phase-0/verification-semantics.md)** | Workstream C | Formal tri-state verdict definitions (`PASS`, `FAIL`, `INCONCLUSIVE`), failure taxonomy, multi-condition aggregation rules, standardized reason codes, and rejection of pseudo-confidence scores. |
| **[domain-contracts.md](file:///c:/agentproof/agentproof/docs/phase-0/domain-contracts.md)** | Workstream D | Strongly-typed TypeScript domain models (`VerificationRequest`, `ActionRecord`, `Evidence`, `VerificationResult`, `VerificationTrace`) and core extension interfaces (`IVerifier`, `IStateReader`, `IActionAdapter`, `ITraceRepository`). |
| **[architecture.md](file:///c:/agentproof/agentproof/docs/phase-0/architecture.md)** | Workstream E | Modular monolith architecture, Clean Architecture layers, strict Dependency Inversion direction, directory organization, and adapter extension mechanism. |
| **[mcp-interface.md](file:///c:/agentproof/agentproof/docs/phase-0/mcp-interface.md)** | Workstream F | Complete MCP tool catalog (`verify_outcome`, `inspect_trace`, `list_scenarios`, `run_scenario`), exact Zod schemas, safety guarantees, idempotency rules, and NitroStack controller implementation pattern. |
| **[security-and-trust.md](file:///c:/agentproof/agentproof/docs/phase-0/security-and-trust.md)** | Workstream G | 10-point threat model, trust boundaries, credential redaction policies, prompt-injection immunity, and the fundamental limits of independent observation. |
| **[testing-and-evaluation.md](file:///c:/agentproof/agentproof/docs/phase-0/testing-and-evaluation.md)** | Workstream H | Test pyramid, Vitest adoption, 10 deterministic test cases, benchmark scenario fixture format, and mathematical metric formulations (Precision, Recall, Inconclusive Rate). |
| **[storage-and-observability.md](file:///c:/agentproof/agentproof/docs/phase-0/storage-and-observability.md)** | Workstream I | MVP in-memory persistence strategy, local JSON trace snapshotting, future PostgreSQL migration contract (`ITraceRepository`), and structured logging guidelines. |
| **[implementation-roadmap.md](file:///c:/agentproof/agentproof/docs/phase-0/implementation-roadmap.md)** | Workstream J | 9-phase delivery roadmap from foundation to research hardening, defining the Minimal Viable Vertical Slice (Phases 1–4). |

### Architecture Decision Records (ADRs)
The architectural rationale behind major design choices is documented under `decisions/`:
- **[0001-typescript-and-nitrostack.md](file:///c:/agentproof/agentproof/docs/phase-0/decisions/0001-typescript-and-nitrostack.md)**: Selection of TypeScript and NitroStack.
- **[0002-framework-independent-core.md](file:///c:/agentproof/agentproof/docs/phase-0/decisions/0002-framework-independent-core.md)**: Zero framework dependencies in Core Domain.
- **[0003-deterministic-verification.md](file:///c:/agentproof/agentproof/docs/phase-0/decisions/0003-deterministic-verification.md)**: Deterministic rules as primary verification authority.
- **[0004-simulated-mvp.md](file:///c:/agentproof/agentproof/docs/phase-0/decisions/0004-simulated-mvp.md)**: In-memory simulated record-management environment for MVP.
- **[0005-modular-monolith.md](file:///c:/agentproof/agentproof/docs/phase-0/decisions/0005-modular-monolith.md)**: Modular monolith architecture initially.
- **[0006-inconclusive-verdict-semantics.md](file:///c:/agentproof/agentproof/docs/phase-0/decisions/0006-inconclusive-verdict-semantics.md)**: Tri-state verdict model and inclusion of INCONCLUSIVE.
- **[0007-pluggable-adapters-and-storage.md](file:///c:/agentproof/agentproof/docs/phase-0/decisions/0007-pluggable-adapters-and-storage.md)**: Pluggable interfaces for state readers and trace storage.
- **[0008-deferring-production-db-and-dashboard.md](file:///c:/agentproof/agentproof/docs/phase-0/decisions/0008-deferring-production-db-and-dashboard.md)**: Explicit triggers for introducing databases and dashboards.

---

## 3. Unresolved Questions & Implementation Assumptions

The following items are identified for confirmation prior to commencing Phase 1:

1. **Test Runner Installation Boundary:**
   - *Finding:* The starter template lacks a test runner (`vitest` is not in `package.json`).
   - *Assumption:* Phase 1 will add `vitest` to `devDependencies` and configure `vitest.config.ts`.
2. **Calculator Template Retention:**
   - *Finding:* The starter template ships with `src/modules/calculator/` and associated widgets.
   - *Assumption:* We will preserve the calculator module alongside AgentProof during Phase 1–3 so existing NitroStack CLI build assertions remain satisfied, cleanly decoupling it once AgentProof modules are active.
3. **Transport Default for Production Deployment:**
   - *Finding:* NitroStack defaults to `stdio` in development and `dual` (stdio + HTTP SSE) in production.
   - *Assumption:* AgentProof will support `stdio` for local AI CLI / IDE integrations and `dual` when interacting with external testing harnesses.

---

## 4. Recommended Next Action: Phase 1 Kickoff

The immediate next milestone is **Phase 1: NitroStack Foundation & Test Harness**.

### Phase 1 Acceptance Criteria:
1. `vitest` installed as a devDependency in `c:\agentproof\agentproof\package.json`.
2. `vitest.config.ts` authored with ES Module and TypeScript support.
3. `npm test` script configured and passing a smoke test.
4. `npm run build` (`nitrostack-cli build`) continues to execute with zero errors.
