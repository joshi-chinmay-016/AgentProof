# ADR-005: Trusted Identity and Authorization Architecture

## Status
Accepted

## Context
In earlier phases, MCP tools accepted an optional `tenantId` in the input payload and treated it as the authenticated tenant context. This created a security vulnerability: an untrusted agent could pass an arbitrary `tenantId` (e.g. `'tenant-B'`) to inspect or mutate resources belonging to another tenant. Tenant identifiers are resource scopes, not proofs of identity.

## Decision
1. Introduce an explicit `SecurityPrincipal` and `IIdentityProvider` interface layer.
2. Separate caller identity from caller-requested resource scope.
3. Establish `IAuthorizationService` to enforce operation permissions (`verify:execute`, `trace:read`, `trace:write`, `scenario:run`, `scenario:list`) and strict tenant boundaries.
4. Implement `StaticIdentityProvider` (for deterministic unit tests), `ContextIdentityProvider` (for token/header authentication), and `DefaultDevelopmentIdentityProvider` (for local development with explicit warning metadata).
5. Fail closed on missing or unauthorized identity without leaking cross-tenant resource existence.

## Consequences
- Callers cannot elevate privileges or access foreign tenant data merely by providing a `tenantId` argument.
- Backward compatibility is preserved for development and test harnesses via configurable identity providers.
- MCP tools enforce authorization centrally before executing verification or storage operations.
