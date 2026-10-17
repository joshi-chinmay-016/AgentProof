# ADR 0004: Simulated Record-Management Environment for MVP

**Status:** Approved  
**Date:** 2026-10-17  
**Deciders:** Principal Architect, QA Lead  

---

## Context
To prove that AgentProof can detect both genuine successes and deceptive false successes, we must execute verification against known ground-truth state. Connecting directly to production third-party APIs (e.g., live Stripe, Salesforce, or AWS accounts) introduces rate limits, flaky external networks, financial costs, credential management overhead, and lack of deterministic control over failure modes.

## Decision
We decide that the **initial working MVP will use a deterministic, in-memory simulated record-management environment** representing customer subscriptions.

The simulation harness provides:
- A pristine in-memory state store.
- An action adapter capable of injecting deliberate failure modes (`FALSE_SUCCESS`, `WRONG_TARGET`, `PARTIAL_UPDATE`, `TIMEOUT`).
- An independent `IStateReader` that queries the in-memory store directly.

## Alternatives Considered
1. **Live External Third-Party API Integration (e.g., Stripe Sandbox):**
   - *Pros:* Demonstrates real-world API interaction.
   - *Cons:* Tests become slow, fragile, and dependent on internet connectivity; cannot easily force Stripe's internal database to swallow a write silently to test false-success detection.
2. **Local Dockerized Database (e.g., PostgreSQL in Docker):**
   - *Pros:* Uses real SQL tables.
   - *Cons:* Adds Docker daemon prerequisite, container startup latency, schema migration overhead, and environmental variability across developer machines.

## Consequences
- **Positive:**
  - Tests run in milliseconds inside Vitest without external prerequisites.
  - 100% reproducible test harness where any failure mode can be reliably injected and verified.
  - Zero cloud costs, zero API keys, zero secrets to manage during early phases.
- **Negative:**
  - Does not demonstrate live network socket communication against real-world database drivers until Phase 7.

## Revisit Conditions
Phase 7 will introduce real-world adapters (e.g., PostgreSQL or GitHub API) as secondary plugins once the core verification engine is proven and hardened.
