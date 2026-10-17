# AgentProof Webhook Event Processing & Correlation

## 1. Event Processing Model

AgentProof separates fast, synchronous webhook ingestion from asynchronous verification and observation.

```
External HTTP Request
         |
         v
[WebhookReceiver]
  ├── Verify Signature
  ├── Check Replay Store
  ├── Persist Event Record (QUEUED)
  └── Return 202 Accepted (Immediately)
         |
         v (Asynchronous dispatch / worker polling)
[WebhookEventProcessor]
  ├── Move to PROCESSING atomically
  ├── Correlate with Pending Request
  ├── Perform Independent Observation (if policy mandates)
  ├── Execute Deterministic Verification Engine
  ├── Persist VerificationTrace
  ├── Append Tamper-Evident Audit Event
  └── Move to COMPLETED
```

---

## 2. Event Lifecycle State Machine

A webhook event record progresses through strictly validated lifecycle states:

```
  +-----------+
  |  RECEIVED |
  +-----------+
        |
        v
  +-----------+
  |  VERIFIED |
  +-----------+
        |
        v
  +-----------+
  |   QUEUED  | <------------------------------------+
  +-----------+                                      |
        |                                            |
        v                                            | (Retryable failure
  +------------+                                     |  with attempts < maxRetries)
  | PROCESSING | ------------------------------------+
  +------------+
   |          |                     |
   v          v                     v
+-----------+ +-------------------+ +---------------+
| COMPLETED | | RETRYABLE_FAILURE | | QUARANTINED   |
+-----------+ +-------------------+ +---------------+
                      |
                      v (attempts >= maxRetries)
              +-------------------+
              | PERMANENT_FAILURE |
              +-------------------+
```

### Valid State Transitions

| From | Permitted Target States | Description |
|---|---|---|
| `RECEIVED` | `VERIFIED`, `QUARANTINED` | Raw event buffered and signature verification underway. |
| `VERIFIED` | `QUEUED`, `QUARANTINED` | Signature valid; persisted to disk for worker processing. |
| `QUEUED` | `PROCESSING`, `QUARANTINED` | Worker picked up event for correlation and verification. |
| `PROCESSING` | `COMPLETED`, `RETRYABLE_FAILURE`, `PERMANENT_FAILURE`, `QUARANTINED` | Processing outcomes. |
| `RETRYABLE_FAILURE` | `QUEUED`, `PROCESSING`, `PERMANENT_FAILURE`, `QUARANTINED` | Re-enqueued for retry after transient failure. |
| `COMPLETED` | *(None — Terminal)* | Trace and audit events persisted; immutable. |
| `PERMANENT_FAILURE`| *(None — Terminal)* | Exhausted retries or non-recoverable error. |
| `QUARANTINED` | *(None — Terminal)* | Quarantined for manual / security inspection. |

Any invalid transition throws `InvalidStateTransitionError` and leaves the stored record unmodified.

---

## 3. Correlation Engine

A webhook event cannot become a PASS result without binding to an expected outcome. The `EventCorrelator` maps incoming webhooks to pending verification requests registered in `IPendingRequestRegistry`.

### Correlation Resolution Strategy

1. **Tenant Boundary**: Event tenant (`event.tenantId`) must match source tenant (`source.tenantId`). Cross-tenant correlation is strictly forbidden.
2. **Event Type Validation**: If `source.allowedEvents` is configured, `event.eventType` must match or be in the allowlist.
3. **Explicit Correlation ID**: Extracts candidate correlation IDs from:
   - Configured property path: `source.correlationRule.correlationIdField` (e.g., `data.object.id`, `orderId`)
   - Standard convention paths: `requestId`, `correlationId`, `data.requestId`, `metadata.correlationId`.
4. **Resource Binding**: If no ID matches, attempts match by `(resourceType, resourceId)` from payload.
5. **Ambiguity Rejection**: If multiple pending requests match the same identifier, the correlator returns `AMBIGUOUS`. The event is marked `PERMANENT_FAILURE` and an audit event is recorded to prevent incorrect verdicts.
6. **Unmatched Events**: If no pending request matches, the event is completed with status `COMPLETED` and error category `UNMATCHED`. **AgentProof never manufactures or fabricates a verification request from an arbitrary incoming webhook.**

---

## 4. Independent State Observation Integration

When an event matches a pending request:
- If `source.autoVerifyState: true` or `request.policy.requireIndependentSource: true`:
  1. The processor resolves the configured `IExternalStateReader` for the target system.
  2. An independent ground truth read is executed (e.g., via `RestApiStateReader`, `PostgresStateReader`, or `S3ObjectStateReader`).
  3. The `ExternalObservationRecord` is converted into standard `Evidence` using `ExternalEvidenceAdapter`.
  4. If the observation read fails (network timeout, rate limit, connection refusal):
     - The evidence is marked with `limitations: ['TIMEOUT_CONNECTING_TO_API']` and status `ERROR`.
     - The deterministic verification engine evaluates the condition and returns **INCONCLUSIVE**.
     - **CRITICAL INVARIANT**: Read errors are NEVER converted into FAIL or confirmed absence.

---

## 5. Crash Recovery and Idempotency

### Crash Recovery
If the server or worker crashes while events are in `PROCESSING` status:
- Upon restart, `processor.recoverOnStartup()` calls `eventRepository.recoverInFlightEvents()`.
- All uncompleted events in `PROCESSING` state are automatically reset to `RETRYABLE_FAILURE` (`errorCategory: 'SYSTEM_CRASH_RECOVERY'`).
- The worker re-enqueues them for processing.
- Completed events (`COMPLETED`) are never re-executed.

### Idempotency
- If the external provider retries an identical webhook delivery, `FileWebhookReplayStore` recognizes `DUPLICATE_IDENTICAL` and returns `200 OK` without creating another event record, without re-executing verification, and without duplicating traces.
