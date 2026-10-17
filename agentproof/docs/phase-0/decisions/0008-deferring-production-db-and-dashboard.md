# ADR 0008: Deferral of Production Database and Analytics Dashboard

**Status:** Approved  
**Date:** 2026-10-17  
**Deciders:** Principal Architect, Engineering Manager  

---

## Context
A temptation in initial system design is to immediately provision PostgreSQL databases, configure Drizzle ORM migrations, and design full-scale React analytics dashboards. We must determine the exact triggers and phases when these technologies become justified.

## Decision
We decide to **defer external database infrastructure (PostgreSQL/Drizzle) and full-scale analytics dashboards from the MVP (Phases 1–6).** 

They will only be introduced when the following explicit triggers are met:

### Triggers for Database Introduction (PostgreSQL + Drizzle ORM):
1. **Phase 7 Extension Requirements:** When multi-session trace persistence, cross-run historical analytics, or multi-tenant audit querying cannot be accommodated in memory or local JSON files.
2. **Persistence Volume:** When trace storage requirements exceed local memory limits during continuous benchmark stress testing.

### Triggers for Dashboard / UI Widgets (Next.js / React):
1. **Phase 8 Demonstration Milestone:** When visual cards inside NitroStudio or interactive browser widgets directly enhance the clarity of verification demonstrations.
2. The existing Next.js companion app in `src/widgets` will be maintained for MCP `@Widget` bindings in Phase 8, but will not block the delivery of the core verification engine in Phases 1–6.

## Alternatives Considered
1. **Immediate PostgreSQL Setup in Phase 1:**
   - *Pros:* Database is available early.
   - *Cons:* Adds Docker dependencies, slows down CI/CD pipelines, forces migration management during early schema volatility, and distracts from core verification engine design.
2. **Building a Standalone Analytics Web Dashboard Early:**
   - *Pros:* Visually impressive.
   - *Cons:* High frontend maintenance cost before the underlying domain models and MCP interfaces stabilize.

## Consequences
- **Positive:**
  - Laser focus on verification semantics, type contracts, and benchmark accuracy.
  - Zero friction setup: developers clone the repo and immediately run `npm test` without spinning up databases.
- **Negative:**
  - Traces reset when the in-memory server restarts during early phases (unless file snapshotting is enabled).

## Revisit Conditions
Revisited in Phase 7 for database storage and Phase 8 for interactive UI widgets.
