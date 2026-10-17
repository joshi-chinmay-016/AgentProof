# ADR-013: Durable Replay Protection

## Status
Accepted

## Context
External webhook senders frequently deliver duplicate requests due to network timeouts, retries, or at-least-once delivery guarantees. Furthermore, malicious adversaries can capture valid signed webhooks and replay them later, or attempt to reuse existing event identifiers with altered payloads. Memory-only replay stores lose state upon server restart, leaving the system vulnerable.

## Decision
1. **Durable Tenant-Scoped Keying:** Webhook uniqueness keys are scoped strictly to the tenant and source: `${tenantId}:${sourceId}:${eventId}`. Tenants cannot collide with or observe each other's event IDs.
2. **Digest-Aware Claim Logic:**
   - **`FIRST_SEEN`:** Event is claimed and written to disk. Proceed to acceptance.
   - **`DUPLICATE_IDENTICAL`:** Same event ID and identical payload digest. The server acknowledges receipt with HTTP `200 OK` (`duplicate: true`) without re-executing verification or duplicating traces.
   - **`DUPLICATE_CONFLICT`:** Same event ID with altered payload digest. Treated as a security violation and rejected with HTTP `409 Conflict`.
3. **Crash Resilience:** Replay records are written atomically to disk (`FileWebhookReplayStore`) with `.tmp` staging and atomic renaming, ensuring replay protection survives process crashes and restarts.
4. **Time-to-Live Purging:** Replay records are assigned configurable retention durations (default 24 hours), with expired records safely purged by `purgeExpired()`.

## Consequences
- Guarantees idempotent handling of legitimate provider retries.
- Blocks replay attacks across server restarts.
- Immediately identifies and blocks fraudulent payload alteration attacks on reused event IDs.
