# ADR 0005: Modular Monolith Architecture Initially

**Status:** Approved  
**Date:** 2026-10-17  
**Deciders:** Principal Architect, Systems Engineer  

---

## Context
A verification platform could conceivably be designed as a distributed cluster of microservices: an API gateway, a verification worker queue, an evidence capture service, a trace database service, and a scenario execution runner. However, introducing distributed systems infrastructure prematurely introduces immense complexity.

## Decision
We decide to build **AgentProof as a Modular Monolith** contained within a single Node.js codebase and process.

Internal modules are strictly partitioned by layer and interface boundaries:
- Core Domain (`src/core/`)
- Application Orchestration (`src/application/`)
- Secondary Adapters (`src/adapters/`)
- MCP Presentation Modules (`src/modules/`)

## Alternatives Considered
1. **Microservices with gRPC / Message Queues:**
   - *Pros:* Independent horizontal scaling of individual components.
   - *Cons:* Massive overhead in network serialization, latency, distributed tracing, Kubernetes configuration, and local developer setup; severe drag on iteration speed.
2. **Serverless Lambda Functions:**
   - *Pros:* Scalability per invocation.
   - *Cons:* Cold start latency violates fast verification requirements; stateful in-memory testing becomes cumbersome.

## Consequences
- **Positive:**
  - Simple deployment and single-command local development (`nitrostack-cli dev`).
  - Ultra-fast in-memory function calls between layers.
  - Straightforward refactoring and atomic Git commits.
  - High developer velocity and cognitive clarity.
- **Negative:**
  - All components scale vertically together within the single Node.js instance.

## Revisit Conditions
If verification workloads scale to millions of concurrent requests requiring horizontal verification worker pools, the application layer ports and adapters will allow extracting worker services cleanly without rewriting core domain logic.
