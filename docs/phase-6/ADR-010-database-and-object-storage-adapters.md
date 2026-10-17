# ADR-010: Database and Object Storage Adapters

## Status
Accepted

## Context
In addition to REST APIs, agents claim actions against relational databases (e.g. updating rows, creating records) and cloud object stores (e.g. uploading report PDFs or data artifacts).
Adding heavy vendor SDKs (e.g. full AWS SDK) increases dependency bloat and security attack surface. Allowing arbitrary SQL creates severe SQL injection risks.

## Decision
1. **Lightweight S3 Adapter:** Implement `S3ObjectStateReader` over standard S3 REST protocol using read-only `HEAD` operations. Enforce strict bucket and key prefix restrictions. Do not claim ETag is equivalent to a SHA-256 content digest.
2. **Parameterized PostgreSQL Reader:** Implement `PostgresStateReader` using parameterized queries against allowlisted schemas, tables, and columns. Never concatenate untrusted identifiers or values. Enforce `LIMIT 1`.
3. **Driver Injection:** Decouple drivers (`IPostgresDriver`, `fetchFn`) to enable hermetic, mock-driven unit/integration testing without requiring live third-party cloud accounts or daemon processes in CI.

## Consequences
- Fast, zero-overhead testing in CI.
- No risk of SQL injection or arbitrary query execution from MCP prompts.
- Honest cryptographic reporting regarding S3 ETags.
