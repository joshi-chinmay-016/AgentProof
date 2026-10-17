# AgentProof — MCP Operations Guide

## 1. Tool Catalog Overview

AgentProof exposes four hardened MCP tools over STDIO:

1. `verify_outcome` — Independently verifies an agent operation against observed evidence.
2. `inspect_trace` — Inspects an immutable, tenant-isolated audit trace.
3. `run_scenario` — Executes a deterministic simulation scenario.
4. `list_scenarios` — Discovers registered simulation scenarios.

---

## 2. Tool Details & Authorization Requirements

### `verify_outcome`
- **Required Permission:** `verify:execute`
- **Tenant Scope:** Caller must be authorized for `target.tenantId` or `tenantId`.
- **Input Parameters:**
  - `target` (system, resourceType, resourceId, tenantId)
  - `intent` (operation, summary, expectedChanges)
  - `postconditions` (array of conditions, max 50)
  - `preconditions` (optional array of conditions)
  - `action` (optional claimed action record from agent)
  - `evidence` (array of evidence items, max 100)
  - `policy` (timeoutMs, requireIndependentSource, freshnessToleranceMs)
- **Response Structure:**
  - `overallVerdict`: `'PASS' | 'FAIL' | 'INCONCLUSIVE'`
  - `summary`: Machine and human readable verdict summary
  - `conditionEvaluations`: Per-condition breakdown with reason codes
  - `evidenceManifest`: Array of evidence items with verified SHA-256 hashes
  - `traceId`: UUID of durably persisted audit trace

### `inspect_trace`
- **Required Permission:** `trace:read`
- **Tenant Scope:** Scoped strictly to caller's authenticated tenant. Cross-tenant access is rejected with `TraceNotFoundError` to avoid existence leakage.
- **Input Parameters:**
  - `traceId` (UUID string)
  - `tenantId` (optional requested scope)
- **Response Structure:**
  - Complete immutable audit trace (request, action, evidence, result, timestamps).

### `run_scenario`
- **Required Permission:** `scenario:run`
- **Available Scenarios:**
  - `SCENARIO_A` (Genuine Success -> PASS)
  - `SCENARIO_B` (False Success -> FAIL)
  - `SCENARIO_C` (Wrong Target -> FAIL)
  - `SCENARIO_D` (Partial Update -> FAIL)
  - `SCENARIO_E` (Observation Unavailable -> INCONCLUSIVE)
  - `SCENARIO_F` (Tenant Isolation -> INCONCLUSIVE)
- **Execution Isolation:** Runs in a fresh isolated simulation environment.

### `list_scenarios`
- **Required Permission:** `scenario:list`
- **Response Structure:**
  - Array of scenario definitions, descriptions, and expected outcomes.

---

## 3. Operational Error Handling

AgentProof distinguishes **verification verdicts** from **operational errors**:

- **Verdicts (PASS, FAIL, INCONCLUSIVE):** Returned as standard tool execution responses with `status: 'success'`.
- **Operational Failures:** Thrown as typed errors:
  - `AuthenticationError`: Missing or invalid credentials.
  - `AuthorizationError`: Caller lacks required permission.
  - `TenantAccessDeniedError`: Attempt to access resources outside authorized tenant scope.
  - `DuplicateTraceError`: Attempt to overwrite existing immutable trace.
  - `TraceNotFoundError`: Requested trace does not exist or access was denied.
  - `CorruptedRecordError`: Disk payload failed SHA-256 envelope checksum.
