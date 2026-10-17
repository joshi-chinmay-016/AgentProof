# AgentProof — Security Architecture Specification

## 1. Threat Model & Trust Boundaries

AgentProof operates as an independent verification authority for AI agents. In this role, it must defend against several critical security and integrity threats:

1. **Identity Spoofing & Scope Elevation:** An untrusted agent passing an arbitrary `tenantId` in the tool input payload to access or mutate another tenant's audit traces.
2. **Evidence Tampering & Forgery:** An agent forging payload content or asserting fraudulent `trustLevel: 'ATTESTED'` metadata to force a verification `PASS`.
3. **Audit History Rewriting:** Overwriting or truncating existing verification traces to hide failures, hallucinated actions, or security incidents.
4. **Cross-Tenant Information Leakage:** Probing trace IDs through `inspect_trace` to determine whether another tenant executed specific actions.
5. **Denial of Service / Resource Exhaustion:** Flooding the verifier with unbounded postconditions or gigabyte-sized evidence payloads.

---

## 2. Trusted Identity & Principal Resolution

### SecurityPrincipal
Every operation executed through AgentProof must resolve to an authenticated `SecurityPrincipal`:

```typescript
export interface SecurityPrincipal {
  readonly principalId: string;
  readonly tenantId: string;
  readonly principalType: 'USER' | 'AGENT' | 'SERVICE' | 'SYSTEM';
  readonly permissions: readonly string[];
  readonly authMethod: string;
  readonly metadata?: Record<string, unknown>;
}
```

### Identity Providers
- `IIdentityProvider`: Contract resolving request context into a verified `SecurityPrincipal`.
- `StaticIdentityProvider`: Injected deterministic principal for unit testing and automated harness tests.
- `ContextIdentityProvider`: Resolves tokens from context, authorization headers (`Bearer <token>`), or explicit caller headers (`x-agentproof-tenant`, `x-agentproof-principal`).
- `DefaultDevelopmentIdentityProvider`: Development-only fallback enabled when `AGENTPROOF_DEV_AUTH=true`. Issues explicit warning metadata to prevent silent production deployment.

### Tenant Identifier vs. Authenticated Identity
A caller-provided `tenantId` in tool arguments is treated strictly as a **requested resource scope**, never as proof of authentication. The authorization service compares the requested scope with `principal.tenantId`:
- If `principal.tenantId === '*'`: Global administrative access is granted.
- If `requestedScope === principal.tenantId`: Access is granted.
- If `requestedScope !== principal.tenantId`: Denied immediately with `TenantAccessDeniedError`.

---

## 3. Least-Privilege Authorization

Permissions are enforced prior to executing any domain operation:

| Permission | Operations Allowed |
|---|---|
| `verify:execute` | Execute deterministic verification via `verify_outcome` |
| `trace:read` | Inspect and read audit traces via `inspect_trace` |
| `trace:write` | Persist or append audit traces to `ITraceRepository` |
| `scenario:run` | Execute simulation scenarios via `run_scenario` |
| `scenario:list` | Discover registered scenarios via `list_scenarios` |
| `*` | Full administrative access across all tools and tenants |

---

## 4. Tenant Isolation & Data Access

1. **Strict Partitioning:** Repository data is partitioned by tenant on disk (`storageDir/tenants/<tenantId>/<traceId>.json`).
2. **Explicit Scoping:** Repository APIs require tenant context (`saveForTenant`, `getByTenantAndId`, `listByTenant`).
3. **Existence Concealment:** When a principal requests a trace belonging to another tenant, the system returns `TraceNotFoundError` ("Trace ID does not exist or access was denied") rather than indicating cross-tenant ownership.
4. **Execution Isolation:** Scenarios run in freshly instantiated simulation environments without shared mutable state.

---

## 5. Resource Limits & Bounded Execution

To prevent Denial of Service and algorithmic complexity attacks, Zod input schemas enforce explicit limits:
- Maximum postconditions per request: `50`
- Maximum evidence items per request: `100`
- Maximum payload size: `1 MB`
- String lengths bounded to prevent memory bloat.
