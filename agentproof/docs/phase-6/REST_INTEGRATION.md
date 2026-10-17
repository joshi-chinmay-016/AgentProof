# REST API State Reader Integration

## 1. Overview

`RestApiStateReader` connects AgentProof to real external HTTP/REST services. It executes authenticated read-only requests against configured endpoints, extracts resource state, and produces cryptographic observations for verification.

---

## 2. Configuration Schema

Configured via `RestApiIntegrationConfigSchema`:

```typescript
export const RestApiIntegrationConfigSchema = z.object({
  integrationId: z.string().min(1),
  tenantId: z.string().min(1),
  type: z.literal('REST_API'),
  baseUrl: z.string().url(),
  allowedResourcePatterns: z.array(z.string()).min(1),
  pathMapping: z.record(z.string()).default({}),
  auth: AuthConfigSchema.default({ type: 'NONE' }),
  timeoutMs: z.number().int().positive().max(30000).default(5000),
  maxResponseSizeBytes: z.number().int().positive().max(5 * 1024 * 1024).default(1024 * 1024),
  allowedMethods: z.array(z.enum(['GET', 'HEAD'])).default(['GET', 'HEAD']),
  allowLoopback: z.boolean().default(false),
  enabled: z.boolean().default(true),
  freshnessToleranceMs: z.number().int().nonnegative().default(60000),
});
```

---

## 3. Security & Anti-SSRF Protections

The reader enforces multiple layers of security to prevent Server-Side Request Forgery (SSRF) and data leakage:

1. **Scheme Validation:** Only `https` is permitted in production. `http` is permitted only when `allowLoopback` is explicitly enabled for testing.
2. **IP & Private Network Rejection:**
   - 10.0.0.0/8 (RFC 1918)
   - 172.16.0.0/12 (RFC 1918)
   - 192.168.0.0/16 (RFC 1918)
   - 127.0.0.0/8 & `localhost` (Loopback blocked unless enabled)
   - 169.254.0.0/16 (Link-local & AWS/GCP/Azure Cloud Metadata: 169.254.169.254)
   - fc00::/7 & fe80::/10 (IPv6 unique-local & link-local)
3. **No Credential Leakage in URLs:** URLs with embedded credentials (e.g. `https://user:pass@host`) are strictly rejected.
4. **Disallowed Automated Redirects:** `fetch` is executed with `redirect: 'error'` to prevent automated redirect bypasses into private network endpoints.
5. **Path Allowlisting:** Every resolved path is validated against `allowedResourcePatterns`. Path traversal (`..`, `//`) is prohibited.
6. **Credential Redaction:** Header logging and evidence metadata automatically redact `Authorization`, `X-API-Key`, `Cookie`, `Set-Cookie`, and other sensitive tokens.
7. **Strictly Read-Only:** Only `GET` and `HEAD` methods are implemented. No write methods are exposed.

---

## 4. Status Code Mapping

| HTTP Status | Result Status | Result Error Category | Meaning |
| :--- | :--- | :--- | :--- |
| `200 OK` | `FOUND` | `undefined` | Resource exists and payload was parsed successfully. |
| `404 Not Found` | `NOT_FOUND` | `undefined` | Endpoint confirmed resource non-existence. |
| `401 / 403` | `READ_ERROR` | `AUTHORIZATION_FAILURE` | Invalid or rejected reader credentials. |
| `429` | `READ_ERROR` | `RATE_LIMITED` | Remote rate limit exceeded. |
| `5xx` | `READ_ERROR` | `NETWORK_ERROR` | Remote server failure. |
| `AbortError` | `READ_ERROR` | `TIMEOUT` | Request timed out. |
| Invalid JSON | `READ_ERROR` | `MALFORMED_PAYLOAD` | Response body is not valid JSON. |
| > Max Size | `READ_ERROR` | `RESPONSE_TOO_LARGE` | Response exceeded `maxResponseSizeBytes`. |

---

## 5. Local Testing & Mocking

`RestApiStateReader` accepts an injectable `fetchFn` in its options:
```typescript
const reader = new RestApiStateReader(config, {
  secretProvider: new StaticSecretProvider({ BILLING_TOKEN: 'dev-token' }),
  fetchFn: mockFetch,
});
```
This enables fast, deterministic tests without spawning live external servers.
