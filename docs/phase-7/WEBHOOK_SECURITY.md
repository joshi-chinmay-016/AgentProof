# AgentProof Webhook Security Architecture

## 1. Threat Model

AgentProof's webhook receiver operates as an external-facing network ingestion boundary. The threat model accounts for untrusted internet callers, malicious tenants, network adversaries, and compromised replay attempts:

| Threat | Impact | Security Mitigation |
|---|---|---|
| **Forged Webhook Signature** | Attacker injects false success claims | Cryptographic verification over raw request bytes before parsing payload; timing-safe comparisons. |
| **Replay Attack** | Attacker resends captured valid request | Durable `FileWebhookReplayStore` with tenant-scoped uniqueness key `tenantId:sourceId:eventId`. |
| **Tampered Duplicate (Replay Conflict)** | Attacker reuses valid event ID with modified payload | Store computes SHA-256 payload digest. Duplicate ID with mismatched digest triggers immediate `409 Conflict`. |
| **Timestamp Manipulation / Stale Requests** | Attacker replays old requests outside retention | Configurable `maxClockSkewMs` enforcement against server clock. Expired timestamps rejected immediately. |
| **Oversized Request DoS** | Memory exhaustion via unbounded body stream | Stream-level byte counter caps request body at `maxPayloadBytes` (default 1 MB); excess triggers `413 Payload Too Large` without memory buildup. |
| **Malformed JSON DoS** | Parsing crash or CPU exhaustion | Safe parsing wrapped in try/catch returning `400 Bad Request`. |
| **Cross-Tenant Event Injection** | Tenant A attempts to correlate event for Tenant B | Tenant identity resolved exclusively from trusted server-side source config (`source.tenantId`), never from payload fields. |
| **Timing Attacks on Signatures** | Attacker derives secret bytes via comparison latency | `crypto.timingSafeEqual` applied to fixed-length signature digests; invalid length short-circuits safely. |
| **Information / Secret Leakage** | Leaking signing secrets or stack traces in errors | Responses return sanitized error categories (`401 Unauthorized`, `409 Conflict`) without stack traces or secret strings. |

---

## 2. Trusted Source Configuration

Webhook sources are statically or administratively provisioned via `IWebhookSourceRegistry`. External callers cannot self-register sources or alter source properties.

```typescript
export interface WebhookSourceConfig {
  sourceId: string;                     // Unique identifier in receiver URL
  tenantId: string;                     // Authoritative tenant boundary
  provider: 'STRIPE' | 'GITHUB' | 'CUSTOM_HMAC' | 'AWS_SNS' | 'GENERIC';
  signatureScheme: 'HMAC_SHA256' | 'RSA_SHA256';
  secretRef: string;                    // Indirection to secret provider
  publicKeyId?: string;                 // Identifier for RSA public key
  signatureHeader: string;              // e.g., 'stripe-signature', 'x-hub-signature-256'
  timestampHeader: string;              // e.g., 'x-timestamp'
  eventIdHeader: string;                // e.g., 'x-event-id'
  maxClockSkewMs: number;               // Max skew tolerance (default 10s, max 5m)
  replayRetentionMs: number;            // Replay protection window (default 24h)
  allowedEvents: string[];              // Allowed event types or ['*']
  enabled: boolean;                     // Administrative kill-switch
  autoVerifyState: boolean;             // Trigger independent Phase 6 read
  correlationRule: CorrelationRule;     // Mapping fields for correlation
}
```

---

## 3. Cryptographic Signature Verification

### 3.1 Raw Byte Verification
Signature verification executes directly on the unparsed request buffer (`Buffer`). Re-serializing parsed JSON is strictly forbidden because key ordering, whitespace, and Unicode escape variations invalidate cryptographic signatures.

### 3.2 HMAC-SHA256
Supported formats:
1. **GitHub style**: `sha256=<hex_digest>`
2. **Standard hex**: `<hex_digest>`
3. **Stripe style**: `t=<timestamp>,v1=<hex_digest>`, verified over `${timestamp}.${rawBody}`.

Constant-time comparison implementation:
```typescript
private safeCompare(actualHex: string, expectedHex: string): boolean {
  if (actualHex.length !== expectedHex.length) {
    return false;
  }
  const actualBuf = Buffer.from(actualHex, 'utf8');
  const expectedBuf = Buffer.from(expectedHex, 'utf8');
  return crypto.timingSafeEqual(actualBuf, expectedBuf);
}
```

### 3.3 Asymmetric RSA-SHA256
When `signatureScheme: 'RSA_SHA256'` is configured:
- Public keys are resolved server-side using `source.publicKeyId`.
- Signatures in `base64` or `hex` are verified against raw bytes using `crypto.createVerify('SHA256')`.
- Public keys supplied in the payload or headers are rejected.

---

## 4. Freshness and Replay Defense

### 4.1 Timestamp Freshness
When the signing scheme binds a timestamp (e.g., Stripe `t=...` or `x-timestamp` header):
1. Timestamp is converted to milliseconds.
2. Clock skew is computed: `Math.abs(serverNow - eventTime)`.
3. If `skew > source.maxClockSkewMs`, request is rejected with `401 Unauthorized` (`EXPIRED_TIMESTAMP`).
4. Future timestamps beyond tolerance are similarly rejected.

### 4.2 Durable Replay Store
Every accepted webhook claims its identifier in `IWebhookReplayStore`:
- **Uniqueness Key**: `tenantId + ":" + sourceId + ":" + eventId`
- **Payload Digest**: SHA-256 hash of raw request bytes.

Outcomes:
- `FIRST_SEEN`: Event accepted for durable ingestion.
- `DUPLICATE_IDENTICAL`: Identical event ID and identical payload digest. The server acknowledges receipt with `200 OK` (`duplicate: true`) without re-executing verification or duplicating traces.
- `DUPLICATE_CONFLICT`: Event ID reused with altered payload digest. The server immediately returns `409 Conflict` and rejects the event.

Replay records persist to disk (`FileWebhookReplayStore`) with atomic file writes, surviving server restarts.

---

## 5. Deployment Guidance

1. **TLS Termination**: The webhook receiver must be deployed behind a TLS-terminating reverse proxy (e.g., NGINX, Cloudflare, AWS ALB) enforcing HTTPS and modern cipher suites.
2. **Reverse Proxy Configuration**: Ensure the reverse proxy does not strip custom headers (e.g., `stripe-signature`, `x-hub-signature-256`, `x-timestamp`, `x-event-id`).
3. **Payload Limits**: Network-level proxies should enforce a hard body limit of 2 MB to protect against network-level exhaustion before requests reach Node.js.
4. **Secret Storage**: Webhook secrets must be injected via environment variables or secure key vaults, referencing `secretRef` indirections rather than hardcoded configurations.
