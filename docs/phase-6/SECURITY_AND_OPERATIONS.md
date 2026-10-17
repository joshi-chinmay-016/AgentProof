# Security & Operational Guidelines

## 1. Credential Management & Secret Isolation

1. **Zero Hardcoded Credentials:** No API keys, passwords, or tokens are committed to source control.
2. **`ISecretProvider` Decoupling:** Integrations refer to secrets by reference name (`secretRef`), resolved dynamically at request time via `EnvironmentSecretProvider` (or Vault/AWS Secrets Manager in production).
3. **No Leakage in MCP Responses:** Secret values are never returned to MCP callers or embedded in verification results or traces.
4. **Header Redaction:** Request and response headers logged or stored in trace metadata have sensitive tokens (`Authorization`, `X-API-Key`, `Cookie`, etc.) redacted to `'[REDACTED]'`.

---

## 2. Multi-Tenant Isolation

1. **Composite Key Partitioning:** Integration configurations are stored with composite keys `${tenantId}:${integrationId}`.
2. **Fail-Closed Resolution:** When resolving an integration, the caller's authorized tenant context must match the integration's tenant.
3. **No Information Disclosure:** Querying an integration that belongs to another tenant throws a generic `TenantAccessDeniedError` without revealing whether the integration exists.
4. **Trace Partitioning:** Verification traces are persisted in tenant-specific directories (`.agentproof/data/traces/tenants/{tenantId}/`).

---

## 3. Network & Transport Security

1. **SSRF Guard:** Blocks RFC 1918 private IPs, AWS/GCP metadata endpoints (169.254.169.254), loopback addresses, and unauthorized protocols.
2. **No Automated Redirects:** HTTP clients set `redirect: 'error'` to prevent redirect chains from bypassing SSRF checks.
3. **Strict Path Allowlists:** Readers only issue requests to explicitly pre-approved paths.
4. **Bounded Responses:** `maxResponseSizeBytes` caps incoming payloads to 1MB (configurable up to 5MB) to defend against memory exhaustion attacks.
5. **Timeouts:** Request timeouts are bounded by default to 5000ms (max 30000ms).

---

## 4. Operational Observability & Logging

Logs record operational metadata without leaking private data:
- `traceId`: Unique UUID for trace audit.
- `integrationId`: Integration identifier.
- `target`: System, resourceType, and resourceId.
- `durationMs`: Time taken for external read and verification.
- `verdict`: PASS, FAIL, or INCONCLUSIVE.
- `reasonCode`: Explicit reason for verdict.
