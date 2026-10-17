# AgentProof Web Console Architecture

## 1. System Context & Overview

AgentProof is an independent verification layer designed to evaluate whether AI agent tool executions actually produced the intended state changes in target systems.

The Phase 8 Web Console provides an observable, forensic, and developer-friendly operational interface without compromising the security boundaries of the core verification engine or the MCP protocol.

```
                    ┌────────────────────────────────────────┐
                    │       Web Browser (Developer UI)       │
                    └───────────────────┬────────────────────┘
                                        │ HTTP / REST / SPA
                                        ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                         ConsoleServer (HTTP:3000)                          │
├────────────────────────────────┬───────────────────────────────────────────┤
│    Static File Server (SPA)    │            ConsoleApiHandler              │
│    - /                         │            - /api/health                  │
│    - /styles/theme.css         │            - /api/overview                │
│    - /js/app.js                │            - /api/verifications           │
│                                │            - /api/evidence                │
│    WebhookReceiver             │            - /api/timeline                │
│    - /api/v1/webhooks/:sourceId│            - /api/audit/integrity         │
│    - /webhooks/:sourceId       │            - /api/integrations            │
│                                │            - /api/scenarios               │
└────────────────────────────────┴─────────────────────┬─────────────────────┘
                                                       │
                                                       ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                         Core Verification Layer                            │
├────────────────────────────────────────────────────────────────────────────┤
│  VerificationEngine                                                        │
│  - Evaluates Postconditions against Evidence                               │
│  - Computes PASS / FAIL / INCONCLUSIVE                                     │
├────────────────────────────────────────────────────────────────────────────┤
│  FileTraceRepository (Durable partitioned storage)                         │
│  FileAuditEventRepository (Append-only SHA-256 hash-chain)                 │
│  AuditChainVerifier & AuditCheckpointManager (RSA-SHA256 signatures)       │
│  ScenarioCatalog & ScenarioRunner (Deterministic simulations)              │
│  IntegrationRegistry (Postgres, S3, REST API readers with secret masking)  │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Strict Boundary Separation: MCP STDIO vs. Browser HTTP API

A key architectural requirement of Phase 8 is that **the MCP STDIO server and the Browser Console API must remain completely decoupled**:

1. **Transport Isolation**:
   - The MCP server operates strictly over `process.stdin` and `process.stdout`.
   - Any log output or HTTP traffic written to `stdout` would corrupt JSON-RPC 2.0 framing and crash MCP client connections (e.g. Claude Desktop or Cursor).
   - `ConsoleServer` runs as an independent HTTP listener (`http.createServer`) and never emits server logs to `stdout` when running in STDIO mode.

2. **Privilege Boundaries**:
   - The MCP STDIO server runs with local system agent privileges.
   - The browser-facing API is network-exposed and strictly validates all requests, sanitizes errors, redacts credentials, and enforces tenant scoping.
   - Filesystem paths, private encryption keys, raw webhook signing secrets, and database passwords are never exposed to the browser.

---

## 3. The Authoritative Verdict Invariant

A fundamental rule of AgentProof is:

> **The backend remains the sole authority for verification outcomes. The frontend must never invent, infer, or recalculate authoritative verdicts.**

- The browser client merely renders the structured `VerificationResult` returned by `VerificationEngine`.
- Optimistic updates that predict `PASS` before independent evidence is confirmed are strictly forbidden.
- The UI strictly enforces the tri-state display:
  - `PASS`: Green badge, confirmed by trusted independent evidence.
  - `FAIL`: Red badge, independent evidence proved postcondition violation.
  - `INCONCLUSIVE`: Amber warning badge, evidence was missing, stale, or conflicting. Under no circumstances is `INCONCLUSIVE` rendered as a success-like green state.

---

## 4. Tenant Isolation in the Browser API

The Web Console enforces multi-tenant boundaries on every endpoint:

1. **Tenant Identification**: The client sends the tenant identifier in the `x-agentproof-tenant` header (defaulting to `'default-tenant'`).
2. **Repository Scoping**:
   - `ITraceRepository.listByTenant(tenantId)` retrieves only traces belonging to the authenticated tenant.
   - `ITraceRepository.getByTenantAndId(tenantId, traceId)` returns `404 Not Found` if a trace belongs to another tenant, preventing cross-tenant existence enumeration.
   - `IAuditEventRepository.getEvents(tenantId)` scopes hash-chain verification strictly to the tenant's partition.
3. **Cross-Tenant Access Denial**: If a request attempts to inspect or execute operations across unauthorized tenant boundaries, the server returns `403 Forbidden` or `404 Not Found`.

---

## 5. Secret Redaction Policy

External reader configurations and webhook ingestion records often reference sensitive credentials (database passwords, AWS secret access keys, bearer tokens, HMAC signing secrets).

The `ConsoleApiHandler` applies a zero-secret-leakage policy:
- **Reference Preservation**: Secrets are stored and referenced via `vault://` or `env://` URIs.
- **Payload Masking**: If raw secret tokens or credentials exist in headers or configs, they are replaced with `[MASKED_SECRET_REF]` or `[MASKED_CREDENTIAL]` before JSON serialization.
- **Client Sanitization**: The frontend never receives, stores, or transmits raw secret material.
