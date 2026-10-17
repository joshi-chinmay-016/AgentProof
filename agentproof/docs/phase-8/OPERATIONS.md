# AgentProof Web Console — Operations & Production Readiness Guide

## 1. Environment Configuration

The console server and background verification subsystems are configured via environment variables.

| Variable | Type | Default | Description |
|---|---|---|---|
| `CONSOLE_PORT` or `PORT` | number | `3000` | HTTP port on which the web console and API listen |
| `CONSOLE_HOST` or `HOST` | string | `0.0.0.0` | Host address binding (`0.0.0.0` for all interfaces, `127.0.0.1` for local only) |
| `AGENTPROOF_STORAGE_DIR` | string | `.agentproof/data/traces` | Base directory for durable, partitioned verification traces |
| `AGENTPROOF_AUDIT_DIR` | string | `.agentproof/data/audit` | Base directory for append-only audit event hash-chains and checkpoints |
| `AGENTPROOF_WEBHOOK_DIR`| string | `.agentproof/data/webhook-events` | Base directory for durable webhook event persistence |
| `NODE_ENV` | string | `production` | Node environment (`development` enables verbose debug output) |

---

## 2. Server Startup & Lifecycle

### Starting the Console Server

```bash
# Build the application
npm run build

# Start the console server
node dist/server/run-console.js

# Or start via npm script
npm run start:console
```

Console startup logs:
```
[AgentProof] Web Console running at http://localhost:3000
[AgentProof] API Base URL: http://localhost:3000/api
[AgentProof] Webhook Ingest URL: http://localhost:3000/api/v1/webhooks/:sourceId
```

### Graceful Shutdown

The `ConsoleServer` listens for `SIGINT` and `SIGTERM` signals:
1. Closes the HTTP server listener to reject new incoming connections.
2. Allows in-flight verification requests to finish evaluation without corrupting persistent stores.
3. Flushes file handles and closes repository locks cleanly.

---

## 3. Health Monitoring & Observability

### Health Check Endpoint: `GET /api/health`

Returns HTTP 200 with JSON payload detailing status of internal subsystems:

```json
{
  "status": "healthy",
  "version": "1.0.0",
  "uptimeSec": 432,
  "timestamp": "2026-10-17T15:00:00.000Z",
  "subsystems": {
    "verificationEngine": "operational",
    "traceRepository": "operational",
    "auditChain": "operational",
    "webhookReceiver": "operational",
    "integrationRegistry": "operational"
  }
}
```

### Audit Integrity Endpoint: `GET /api/audit/integrity`

Performs an on-demand cryptographic verification of the tenant's append-only hash chain:
- Verifies that every record's `previousDigest` matches the previous event's `currentDigest`.
- Confirms sequence numbers are monotonically increasing with no gaps.
- Compares against signed checkpoints to detect whole-chain rewrites.

---

## 4. CORS & Reverse Proxy Configuration

In production deployments, the Web Console can be deployed behind an ingress proxy (e.g., NGINX, Cloudflare, or AWS ALB):

```nginx
# Example NGINX configuration
server {
    listen 80;
    server_name console.agentproof.internal;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

CORS is managed by `ConsoleApiHandler`. Allowed origins can be passed via `ConsoleApiHandlerOptions.allowedOrigins`. Wildcard CORS combined with credentials is never allowed.
