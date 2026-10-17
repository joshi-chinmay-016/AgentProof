# ADR-009: REST Integration Security and SSRF Mitigation

## Status
Accepted

## Context
Connecting AgentProof to external HTTP endpoints introduces critical security risks:
1. Server-Side Request Forgery (SSRF) targeting internal services or cloud instance metadata (e.g., 169.254.169.254).
2. Credential leakage in logs or MCP tool outputs.
3. Denial of service via oversized HTTP response payloads or slowloris connections.

## Decision
1. Implement `SsrfGuard` blocking RFC 1918 private IPv4 ranges, link-local IPv4/IPv6, cloud metadata endpoints (169.254.169.254), and loopback unless explicitly enabled for testing.
2. Require HTTPS for all production base URLs. Disallow embedded credentials in URLs (`user:pass@host`).
3. Enforce strict resource path allowlists (`allowedResourcePatterns`) with path traversal rejection (`..`, `//`).
4. Disable automated HTTP redirects (`redirect: 'error'`) to prevent redirect chains from bypassing destination allowlists.
5. Bound request timeout (max 30s, default 5s) and response size (max 5MB, default 1MB).
6. Decouple credentials from request parameters using `ISecretProvider` and redact authorization headers in metadata.

## Consequences
- AgentProof cannot be used by AI agents as an arbitrary internal HTTP proxy or scanner.
- Internal infrastructure and credentials remain protected against prompt injection and unauthorized traversal.
