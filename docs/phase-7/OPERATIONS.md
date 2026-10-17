# AgentProof Phase 7 Operational Guide

## 1. Runtime Architecture & Coexistence with MCP

AgentProof provides dual-interface capabilities without breaking the standard STDIO-based Model Context Protocol (MCP):
- **MCP Transport**: Uses `process.stdin` and `process.stdout` via NitroStack.
- **Webhook Ingestion Receiver**: Operates over HTTP via Node's native `http.createServer` bound to an isolated port (e.g. `127.0.0.1:3000` or an explicitly configured interface).

The webhook receiver does not write to `stdout`, completely preserving MCP JSON-RPC message framing.

---

## 2. Server & Worker Lifecycle

### 2.1 Starting the Webhook Receiver

```typescript
import {
  WebhookReceiver,
  defaultWebhookSourceRegistry,
  FileWebhookReplayStore,
  FileWebhookEventRepository,
  WebhookEventProcessor,
} from './streaming/index.js';

// 1. Initialize stores
const replayStore = new FileWebhookReplayStore();
const eventRepo = new FileWebhookEventRepository();

// 2. Initialize asynchronous processor
const processor = new WebhookEventProcessor({
  eventRepository: eventRepo,
  sourceRegistry: defaultWebhookSourceRegistry,
  pendingRegistry: defaultPendingRegistry,
});

// 3. Startup crash recovery
await processor.recoverOnStartup();

// 4. Initialize receiver with dispatch callback
const receiver = new WebhookReceiver({
  sourceRegistry: defaultWebhookSourceRegistry,
  replayStore,
  eventRepository: eventRepo,
  onEventQueued: async (tenantId, eventId) => {
    // Dispatch asynchronous processing
    processor.dispatch(tenantId, eventId).catch(console.error);
  },
});

// 5. Start HTTP server
const port = parseInt(process.env.WEBHOOK_PORT || '3000', 10);
await receiver.start(port);
```

### 2.2 Worker Polling
For background catch-up and retry processing:
```typescript
// Poll every 5000ms for pending / retryable events
processor.startWorker(5000);
```

### 2.3 Graceful Shutdown
```typescript
process.on('SIGTERM', async () => {
  await receiver.stop();
  await processor.stopWorker();
  process.exit(0);
});
```

---

## 3. Storage Directory Layout

Default single-host filesystem paths under `.agentproof/data/`:

```
.agentproof/data/
├── replay/
│   └── {tenantId}/
│       └── {sourceId}.json         # Active replay claim records
├── webhook-events/
│   └── {tenantId}/
│       └── {sourceId}/
│           └── {internalEventId}.json # Stored webhook records
└── audit/
    └── {tenantId}/
        ├── chain.json              # Append-only hash chain
        └── checkpoints/
            └── {checkpointId}.json # RSA-signed checkpoints
```

---

## 4. Operational Monitoring & Metrics

Key metrics to track:

| Metric | Threshold Alert | Cause / Mitigation |
|---|---|---|
| `webhooks_401_unauthorized_rate` | > 5% of traffic | Invalid webhook signing secret or expired timestamp clock skew. Check NTP synchronization and secret rotation. |
| `webhooks_409_conflict_rate` | > 0 | Replay attack detected or source system re-issuing duplicate IDs with different content. Security investigation required. |
| `webhooks_413_payload_too_large` | > 0 | External provider sending payloads exceeding configured limit. Increase `maxPayloadBytes` if legitimate. |
| `events_retryable_failure_rate` | > 2% of events | Transient failure in external state reader (e.g., Stripe API 500 or timeout). |
| `events_permanent_failure_rate` | > 1% of events | Schema validation error, missing source, or exhausted retries. |
| `audit_chain_verification_failures` | > 0 (CRITICAL) | Tampering detected in audit log files. Immediate security incident. |

---

## 5. Retention & Purging Policies

- **Replay Records**: Default retention is 24 hours (`86400000 ms`). Call `replayStore.purgeExpired()` via a scheduled cron job (e.g. hourly) to prune expired claim records.
- **Webhook Events**: Events in `COMPLETED` status can be archived or purged after the organizational retention period (e.g., 30–90 days).
- **Audit Chains**: Tamper-evident audit chains are append-only and should **never** be pruned in place. When archiving old sequences, generate and sign an `AuditCheckpoint` anchoring the latest state before archiving historical records.
