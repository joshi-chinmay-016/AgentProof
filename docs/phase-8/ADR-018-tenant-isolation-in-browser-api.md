# ADR-018: Tenant Isolation and Secret Masking in Browser-Facing API

## Status
Accepted

## Context
AgentProof verification traces, audit hash-chains, and external state reader configurations contain enterprise tenant data and sensitive references (e.g., database connection credentials, AWS S3 secret keys, webhook signing secrets).
Exposing this functionality to a browser web console introduces security concerns:
1. One tenant must never be able to inspect or infer the verification traces of another tenant.
2. Secret values must never be leaked to the frontend DOM, browser cache, or network payloads.
3. The frontend must not be able to bypass server-side authorization controls.

## Decision
1. **Server-Side Tenant Scoping**:
   - Every browser API request passes `x-agentproof-tenant` header (defaulting to `'default-tenant'`).
   - `ConsoleApiHandler` scopes all queries to `traceRepository.listByTenant(tenantId)` and `auditRepository.getEvents(tenantId)`.
   - `getByTenantAndId(tenantId, traceId)` returns `404 Not Found` if the requested trace belongs to a different tenant, preventing tenant enumeration attacks.
2. **Secret Redaction**:
   - `handleListIntegrations` sanitizes all integration records.
   - Raw credentials are never transmitted; only safe references (`vault://...` or `env://...`) or `[MASKED_SECRET_REF]` are returned.
   - Webhook headers containing authorization or signatures are replaced with `[MASKED_CREDENTIAL]`.
3. **No Frontend Verdict Authority**:
   - All outcomes (`PASS`, `FAIL`, `INCONCLUSIVE`) are computed server-side by `VerificationEngine`. The frontend cannot modify or override outcomes.

## Consequences
- **Positive**: Strict tenant boundary guarantees even in multi-tenant environments.
- **Positive**: Zero secret leakage to the browser.
- **Positive**: Compliant with enterprise security standards for developer platforms.
