# AgentProof Phase 7: Streaming Attestations, Webhook Verification & Tamper-Evident Audit Events

## 1. Overview and Mission

Phase 7 implements asynchronous webhook ingestion, cryptographic signature verification, durable replay protection, tenant-scoped event correlation, independent state observation, and tamper-evident audit history on top of the established AgentProof architecture.

### Core Objective

Enable AgentProof to receive asynchronous events from configured external systems, verify the authenticity and freshness of those events, prevent replay attacks, correlate events with expected outcomes, independently verify resulting state when required, and preserve the resulting audit history in a tamper-evident format.

Target pipeline:

**External system → Webhook receiver → Signature verification → Replay protection → Durable event ingestion → Event correlation → Independent state observation → Deterministic verification → Durable trace → Tamper-evident audit history**

### Fundamental Verification Invariant

**Not every webhook immediately produces a final verdict.** If an incoming event does not establish the required postconditions, AgentProof remains **INCONCLUSIVE** until sufficient trustworthy evidence becomes available. A signed webhook asserting `success: true` is not automatic proof of resulting state; when required by verification policy or source configuration, follow-up ground truth reads are performed via Phase 6 external state readers.

---

## 2. Phase 7 Architecture

```
                    +----------------------------------------------------+
                    |       External Systems (Stripe, GitHub, etc.)      |
                    +----------------------------------------------------+
                                             |
                                             | Signed HTTP POST (raw bytes)
                                             v
                    +----------------------------------------------------+
                    |       WebhookReceiver (Node HTTP Server)           |
                    |   Route: /api/v1/webhooks/:sourceId                |
                    |   - Raw byte stream buffering (< 1 MB limit)       |
                    |   - Safe HTTP status codes (200, 202, 400, 401,    |
                    |     403, 404, 409, 413, 500)                       |
                    +----------------------------------------------------+
                                             |
                                             v
                    +----------------------------------------------------+
                    |          WebhookSignatureVerifier                  |
                    |   - HMAC-SHA256 (constant-time timingSafeEqual)    |
                    |   - RSA-SHA256 asymmetric public-key verification  |
                    |   - Timestamp freshness tolerance enforcement      |
                    +----------------------------------------------------+
                                             |
                                             v
                    +----------------------------------------------------+
                    |        FileWebhookReplayStore (Replay Store)       |
                    |   - Tenant-scoped key: tenantId:sourceId:eventId   |
                    |   - FIRST_SEEN -> Proceed to durable acceptance    |
                    |   - DUPLICATE_IDENTICAL -> Return 200 OK (no-op)   |
                    |   - DUPLICATE_CONFLICT -> Return 409 Conflict      |
                    +----------------------------------------------------+
                                             |
                                             v
                    +----------------------------------------------------+
                    |      FileWebhookEventRepository (Durable Store)    |
                    |   - Atomic disk persistence (.tmp -> rename)       |
                    |   - Lifecycle: RECEIVED -> VERIFIED -> QUEUED ->   |
                    |     PROCESSING -> COMPLETED / RETRYABLE_FAILURE    |
                    |   - Crash recovery: resets in-flight on restart    |
                    +----------------------------------------------------+
                                             |
                                             | Asynchronous dispatch / worker
                                             v
                    +----------------------------------------------------+
                    |             WebhookEventProcessor                  |
                    +----------------------------------------------------+
                                |                         |
                                v                         v
             +-----------------------+       +-------------------------+
             |    EventCorrelator    |       |   Phase 6 State Readers |
             | - Match pending req   |       | - RestApiStateReader    |
             | - Resource binding    |       | - PostgresStateReader   |
             | - Ambiguity rejection |       | - S3ObjectStateReader   |
             +-----------------------+       +-------------------------+
                                \                         /
                                 v                       v
                    +----------------------------------------------------+
                    |         Deterministic VerificationEngine           |
                    |   Evaluates conditions against evidence            |
                    |   Produces tri-state verdict: PASS, FAIL,          |
                    |   or INCONCLUSIVE (Read error != FAIL)             |
                    +----------------------------------------------------+
                                             |
                                             v
                    +----------------------------------------------------+
                    |          Durable Persistence & Audit Trail         |
                    |   - ITraceRepository: File/Memory trace store      |
                    |   - FileAuditEventRepository: Append-only chain    |
                    |   - AuditChainVerifier: Sequence & link checks     |
                    |   - AuditCheckpointManager: RSA-signed checkpoints |
                    +----------------------------------------------------+
```

---

## 3. Directory Structure

```
src/streaming/
├── contracts/
│   ├── webhook.interface.ts          # WebhookRawRequest, WebhookEventRecord, statuses
│   └── audit.interface.ts            # AuditEvent, AuditCheckpoint, verification result
├── registry/
│   ├── webhook-source.schema.ts      # Zod validation schema for trusted webhook sources
│   └── webhook-source-registry.ts    # IWebhookSourceRegistry & InMemoryWebhookSourceRegistry
├── security/
│   ├── webhook-signature-verifier.ts # Constant-time HMAC-SHA256 & RSA-SHA256 verifier
│   ├── replay-store.interface.ts     # IWebhookReplayStore contract & status types
│   └── file-replay-store.ts          # Durable FileWebhookReplayStore & InMemory store
├── persistence/
│   ├── webhook-event-repository.interface.ts # IWebhookEventRepository contract
│   └── file-webhook-event-repository.ts     # File-backed atomic event repository & recovery
├── audit/
│   ├── audit-canonicalizer.ts        # Deterministic JSON canonicalization & SHA-256
│   ├── audit-repository.interface.ts # IAuditEventRepository contract
│   ├── file-audit-repository.ts      # File-backed append-only audit repository
│   ├── audit-chain-verifier.ts       # Hash-chain linkage and sequence verifier
│   └── checkpoint-manager.ts         # RSA-SHA256 signed audit checkpoint manager
├── receiver/
│   └── webhook-receiver.ts           # HTTP server, routing, body buffering, responses
├── processor/
│   ├── pending-request-registry.ts   # Pending verification request store
│   ├── event-correlator.ts           # Multi-strategy correlation & ambiguity rejection
│   └── webhook-event-processor.ts    # Asynchronous worker, engine execution, audit logging
└── index.ts                          # Public API barrel export
```

---

## 4. Documentation Index

- [WEBHOOK_SECURITY.md](WEBHOOK_SECURITY.md) — Signature schemes, raw body handling, replay defense, and network boundary.
- [EVENT_PROCESSING.md](EVENT_PROCESSING.md) — Event lifecycle state machine, correlation rules, retry semantics, and crash recovery.
- [AUDIT_INTEGRITY.md](AUDIT_INTEGRITY.md) — Hash chain structure, canonicalization, sequence verification, signed checkpoints, and tampering limitations.
- [OPERATIONS.md](OPERATIONS.md) — Running the receiver, worker lifecycle, retention policies, monitoring, and troubleshooting.
- [IMPLEMENTATION_REPORT.md](IMPLEMENTATION_REPORT.md) — Complete validation report, test results, and verified invariants.

### Architecture Decision Records (ADRs)

- [ADR-012: Webhook Signature Verification](ADR-012-webhook-signature-verification.md)
- [ADR-013: Durable Replay Protection](ADR-013-durable-replay-protection.md)
- [ADR-014: Asynchronous Event Processing & Correlation](ADR-014-asynchronous-event-processing-and-correlation.md)
- [ADR-015: Tamper-Evident Audit Chain](ADR-015-tamper-evident-audit-chain.md)
- [ADR-016: Signed Audit Checkpoints](ADR-016-signed-audit-checkpoints.md)
