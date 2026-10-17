# AgentProof — Independent Verification Platform for AI Agents

> **An MCP-native, cryptographically anchored independent verification engine and developer web console for tool-using AI agents.**

[![Tests](https://img.shields.io/badge/tests-288%20passed-brightgreen.svg)](#testing--verification)
[![TypeScript](https://img.shields.io/badge/typescript-strict%205.3-blue.svg)](#architecture)
[![MCP](https://img.shields.io/badge/protocol-MCP%202026--07--28-orange.svg)](#mcp-protocol--tools)
[![Console](https://img.shields.io/badge/console-Phase%208%20Ready-purple.svg)](#agentproof-web-console)

---

## What is AgentProof?

When an AI agent reports *"I have cancelled the customer's subscription"* or *"I updated the database record"*, that assertion is merely an unverified claim. Model context logs, agent thought chains, and tool return values can be hallucinated, incomplete, or silenced by partial system failures.

**AgentProof** is an independent, out-of-band verification layer. It intercepts or receives agent execution intents, reads ground-truth system states from independent evidence providers (PostgreSQL, AWS S3, REST APIs, signed webhooks), and evaluates postconditions using deterministic comparison logic.

### Core Non-Negotiable Rules

1. **Backend Verdicts Are Authoritative**: The UI never computes, overrides, or infers verdicts.
2. **Three Verdicts Only**:
   - `PASS`: Trusted, independent evidence proves all required postconditions hold.
   - `FAIL`: Reliable evidence proves at least one required postcondition was violated.
   - `INCONCLUSIVE`: Evidence is missing, stale, untrusted, conflicting, or unavailable.
   - **Aggregation Precedence**: `FAIL` > `INCONCLUSIVE` > `PASS`.
3. **Missing Evidence is Never Success**: Inability to verify is never marked as `PASS`. Inability to verify is never conflated with `FAIL`.
4. **Observation Statuses are Not Verdicts**: `FOUND`, `NOT_FOUND`, `READ_ERROR`, and `UNTRUSTED` represent evidence retrieval states, visually differentiated from verdicts.
5. **Simulations are Explicitly Flagged**: All simulated runs carry an unmistakable `[SIMULATION]` badge.
6. **Zero Secret Leakage**: Credentials, API tokens, and connection strings are masked server-side (`vault://...`, `env://...`).
7. **Tamper-Evident Hash Chains & Signed Checkpoints**: Audit events are cryptographically hashed in an append-only chain. Full-history rollback attacks are prevented via RSA-SHA256 signed checkpoints.

---

## AgentProof Web Console (Phase 8)

Phase 8 introduces the **AgentProof Developer Security Console**, engineered with Tier-1 developer platform discipline (Linear, Vercel, Stripe, Anthropic Console).

### Console Views & Features

- **Overview Dashboard (`/overview`)**:
  - Live verification metrics: Total runs, authoritative PASS / FAIL / INCONCLUSIVE distribution, and Evidence Completeness Rate.
  - Interactive SVG verdict donut chart with drill-down navigation.
  - "Needs Attention" triage center highlighting failures, inconclusive spikes, and audit warnings.
  - Subsystem status indicators (PostgreSQL, S3, REST, Webhooks, Audit Chain).
  - "Since You Last Visited" banner tracking live changes since previous session.
  - Persistent, dismissible **Getting Started Checklist** tracking onboarding progress.
- **Verification Explorer & Detail Drawer (`/verifications`)**:
  - Filterable verification ledger with search, verdict pills, and pagination.
  - Deep-linkable side inspector drawer.
  - Postcondition checklist displaying JSONPath, operator, expected value, and observed value diff.
  - **Verdict Driver Banner**: Highlights the precise condition that triggered `FAIL` or `INCONCLUSIVE`.
  - Independent evidence card manifest with source kind, freshness window, and SHA-256 integrity digests.
  - Formatted JSON Trace Inspector with copy-to-clipboard.
- **Evidence & Cryptographic Audit Explorer (`/evidence-audit`)**:
  - **Signature 3D Verification Pipeline**: Real-time WebGL/Three.js 4-stage pipeline (`Claimed Action` ➔ `Postconditions` ➔ `Evidence` ➔ `Deterministic Verdict`) with animated photon particle, capped DPR, `IntersectionObserver` pause, and 2D SVG fallback.
  - **Audit Hash Chain Verifier**: Validates live SHA-256 append-only chains over audit records.
  - **Signed RSA Checkpoint Manager**: Inspects asymmetric RSA-SHA256 signed checkpoints.
  - Independent evidence registry and chronological event timeline.
- **Integrations & Webhook Ingest (`/integrations-webhooks`)**:
  - Active state reader inventory (Postgres, S3, REST) with connection health.
  - Safe secret redaction (`vault://...`, `env://...`).
  - Inbound webhook stream with HMAC/RSA signature verification, replay protection, and lifecycle states (`RECEIVED`, `VERIFIED`, `QUEUED`, `PROCESSING`, `COMPLETED`, `QUARANTINED`).
- **Scenario Library & Guided Onboarding (`/scenarios`)**:
  - 4-step interactive onboarding walkthrough teaching the verification model.
  - Complete library of verified scenarios (`SCENARIO_A` to `SCENARIO_H`).
  - One-click simulation runner with live progress feedback and authoritative drawer evaluation.
- **Help, Glossary & Keyboard Shortcuts (`/help` or `?`)**:
  - Interactive command palette (`Ctrl+K` / `Cmd+K`).
  - Monospace keyboard shortcut cheat sheet (`?`).
  - Contextual glossary explaining cryptographic and verification terms.
  - Dark (`Obsidian`) and Light (`Slate`) custom themes with zero flash on load.

---

## Quickstart

### Prerequisites

- Node.js >= 20.0.0
- npm >= 10.0.0

### Installation & Build

```bash
# Clone the repository
git clone https://github.com/joshi-chinmay-016/agentproof.git
cd agentproof/agentproof

# Install dependencies
npm install

# Build the production TypeScript bundle
npm run build
```

### Launching the Web Console

```bash
# Start the Web Console HTTP Server (build + start)
npm run start:console

# Or run directly against existing dist:
npm run console
```

Open your browser at **`http://localhost:3000`**.

---

## MCP Protocol & Tools

AgentProof implements the Model Context Protocol (stateless spec `2026-07-28` and legacy `2025-06-18`). The STDIO transport remains 100% unbuffered and unpolluted.

| Tool | Description |
| :--- | :--- |
| `verify_outcome` | Evaluates agent execution intent and postconditions against independent evidence. |
| `inspect_trace` | Retrieves complete cryptographic traces, evaluations, and evidence manifests by ID. |
| `run_scenario` | Executes predefined test scenarios (`SCENARIO_A` – `SCENARIO_H`) with simulated evidence. |
| `list_scenarios` | Returns catalog of available verification test scenarios and descriptions. |

---

## Architecture

```
                    ┌────────────────────────────────────────┐
                    │               AI AGENT                 │
                    │   (Claims: "Subscription Cancelled")   │
                    └───────────────────┬────────────────────┘
                                        │ Intent & Postconditions
                                        ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        AGENTPROOF PLATFORM                             │
│                                                                        │
│   ┌────────────────────┐   ┌────────────────────┐                      │
│   │   MCP STDIO Tool   │   │ Webhook Ingestion  │                      │
│   │  (verify_outcome)  │   │  (HMAC/RSA Signed) │                      │
│   └─────────┬──────────┘   └─────────┬──────────┘                      │
│             │                        │                                 │
│             ▼                        ▼                                 │
│   ┌──────────────────────────────────────────────┐                     │
│   │       Independent State Readers & Cache      │                     │
│   │    (PostgreSQL, AWS S3, External REST APIs)  │                     │
│   └──────────────────────┬───────────────────────┘                     │
│                          │ Observable Ground Truth                     │
│                          ▼                                             │
│   ┌──────────────────────────────────────────────┐                     │
│   │          Deterministic Verification Engine   │                     │
│   │     Evaluates Postconditions: PASS / FAIL /  │                     │
│   │                 INCONCLUSIVE                 │                     │
│   └─────────┬────────────────────────┬───────────┘                     │
│             │                        │                                 │
│             ▼                        ▼                                 │
│   ┌────────────────────┐   ┌────────────────────┐                      │
│   │ FileTraceRepo      │   │ Cryptographic      │                      │
│   │ (Durable Traces)   │   │ Audit Hash Chain   │                      │
│   └─────────┬──────────┘   └─────────┬──────────┘                      │
│             │                        │                                 │
│             └───────────┬────────────┘                                 │
│                         ▼                                              │
│   ┌──────────────────────────────────────────────┐                     │
│   │         Browser Console HTTP Server          │                     │
│   │         (Port 3000, Tenant-Scoped)           │                     │
│   └─────────────────────┬────────────────────────┘                     │
└─────────────────────────┼──────────────────────────────────────────────┘
                          │ JSON REST API + Static SPA
                          ▼
             ┌─────────────────────────┐
             │ AgentProof Web Console  │
             │   (Linear-grade UI)     │
             └─────────────────────────┘
```

---

## Testing & Verification

The test suite validates domain logic, condition evaluation, concurrency, cryptographic audit chains, webhook signature verification, secret masking, MCP tool registrations, and web console endpoints.

```bash
# Run all 43 test suites (288 tests)
npm test

# Run TypeScript strict typecheck
npx tsc --noEmit

# Run Web Console HTTP & API smoke test
node scripts/console-smoke-test.mjs

# Run MCP STDIO protocol smoke test
node scripts/protocol-smoke-test.mjs
```

### Test Coverage Summary

- **43 Test Files**: 288 passing tests, 0 failures.
- **Server API Tests**: `tests/server/console-api.test.ts` & `tests/server/console-server.test.ts`.
- **MCP Regression Tests**: `tests/mcp/phase-8-mcp-regression.test.ts` guaranteeing zero STDIO stdout leakage.
- **Cryptographic Tests**: RSA-SHA256 signature verification, replay protection, hash-chain tamper detection, and signed checkpoints.

---

## Documentation

- [`docs/phase-8/README.md`](docs/phase-8/README.md): Detailed Phase 8 console capabilities and security model.
- [`docs/FRONTEND.md`](docs/FRONTEND.md): Frontend design tokens, component kit, and typed API contracts.
- [`docs/GAPS.md`](docs/GAPS.md): Authoritative catalog of implemented capabilities vs environment limitations.
- [`docs/phase-8/ADR-017-web-console-architecture.md`](docs/phase-8/ADR-017-web-console-architecture.md): Web console architecture ADR.
- [`docs/phase-8/ADR-018-tenant-isolation-in-browser-api.md`](docs/phase-8/ADR-018-tenant-isolation-in-browser-api.md): Tenant boundary ADR.
- [`docs/phase-8/ADR-019-design-system-and-theming.md`](docs/phase-8/ADR-019-design-system-and-theming.md): Design system and token ADR.
- [`docs/phase-8/ADR-020-signature-verification-visualization.md`](docs/phase-8/ADR-020-signature-verification-visualization.md): Signature 3D visualization ADR.

---

## License

Private and proprietary. Designed and engineered for independent AI agent verification.
