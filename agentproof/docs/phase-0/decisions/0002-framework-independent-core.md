# ADR 0002: Framework-Independent Core Verification Domain

**Status:** Approved  
**Date:** 2026-10-17  
**Deciders:** Principal Architect, Software Reliability Lead  

---

## Context
While NitroStack provides an excellent application framework for MCP tool exposure, coupling the core verification logic directly to framework decorators or runtime classes would severely compromise testability, portable reuse, and long-term maintainability.

## Decision
We enforce a strict architectural boundary: **The Core Domain (`src/core/`) must have ZERO dependencies on `@nitrostack/core`, HTTP libraries, database drivers, or external frameworks.** 

The Core Domain contains:
- Domain contracts and value types (`VerificationRequest`, `Evidence`, `VerificationResult`).
- Pure predicate evaluators (`EQUALS`, `GREATER_THAN`, `CONTAINS`).
- Deterministic rule engine and tri-state verdict aggregation logic.

The NitroStack controllers and providers live in the outer presentation and application layers (`src/modules/` and `src/application/`) and act as consumers of the core domain.

## Alternatives Considered
1. **Embedding Verification Logic in NitroStack `@Tool` Methods:**
   - *Pros:* Faster initial prototyping with fewer files.
   - *Cons:* Makes automated unit testing without a mock NitroStack execution context nearly impossible; entangles verification semantics with transport and JSON-RPC concerns.
2. **Framework-Coupled Injectable Services:**
   - *Pros:* Uses NitroStack's `@Injectable()` everywhere.
   - *Cons:* Precludes running the verification engine in edge runtimes, browser environments, or alternate CLI binaries.

## Consequences
- **Positive:**
  - Lightning-fast unit tests executing pure TypeScript functions with zero mocking overhead.
  - Verification engine can be extracted and distributed as an independent NPM library if desired.
  - Future framework upgrades or migrations will not touch verification rules.
- **Negative:**
  - Requires maintaining explicit mapping/translation layers between MCP DTOs and domain entities.

## Revisit Conditions
This decision is foundational to Clean Architecture and will not be revisited under normal circumstances.
