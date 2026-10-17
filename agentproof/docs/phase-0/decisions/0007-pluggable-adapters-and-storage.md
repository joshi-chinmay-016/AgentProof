# ADR 0007: Pluggable Interfaces for State Readers and Trace Repositories

**Status:** Approved  
**Date:** 2026-10-17  
**Deciders:** Principal Architect, Extensibility Lead  

---

## Context
AgentProof must initially run locally without complex infrastructure, but must ultimately support verifying real-world mutations across cloud databases, SaaS APIs, event streams, and enterprise systems. If the verification service directly imports concrete classes or database clients, adding new target systems requires modifying core code.

## Decision
We decide that **all state observation sources and trace storage engines must implement pluggable TypeScript interfaces (`IStateReader`, `ITraceRepository`) and be resolved via dependency injection.**

- `IStateReader`: Defines how to query state for a specific `ResourceTarget`.
- `ITraceRepository`: Defines how to save and query `VerificationTrace` records.
- `StateReaderRegistry`: Decouples target system routing from the caller.

## Alternatives Considered
1. **Hardcoding Concrete In-Memory Stores Directly into Application Services:**
   - *Pros:* Slightly fewer files and interfaces.
   - *Cons:* Incurs heavy technical debt; requires ripping apart the application service when transitioning to PostgreSQL in Phase 7.
2. **Dynamic Plugin Loading from Unchecked Directories:**
   - *Pros:* Highly extensible.
   - *Cons:* Security risk, complex error handling, and loss of compile-time type safety in early phases.

## Consequences
- **Positive:**
  - In-memory adapters can be replaced with PostgreSQL, DynamoDB, or REST API readers with zero edits to core verification logic.
  - Test suites can inject mock adapters with microsecond response times.
  - Enables clean separation between development, testing, and production runtime environments.
- **Negative:**
  - Introduces interface definitions and registry lookup indirection.

## Revisit Conditions
This pattern aligns with standard Clean Architecture and Port & Adapter conventions and is considered permanent.
