# ADR-006: Durable Verification Trace Persistence

## Status
Accepted

## Context
Phase 4 used an in-memory trace registry (`InMemoryTraceRegistry`). In-memory traces disappear when the process terminates, which is unsuitable for production audit trails. We needed a durable storage mechanism that preserves write-once immutability, enforces tenant partitioning, handles process crashes safely, and has zero external database dependencies for the current development and testing environment.

## Decision
1. Introduce the `ITraceRepository` interface with explicit tenant-scoped operations (`saveForTenant`, `getByTenantAndId`, `listByTenant`).
2. Retain `InMemoryTraceRepository` for fast, deterministic unit tests.
3. Implement `FileTraceRepository` as the primary durable adapter:
   - Zero native C++ dependencies (pure Node.js standard library).
   - Tenant directory partitioning (`<storageDir>/tenants/<tenantId>/<traceId>.json`).
   - Write-ahead temporary file staging with atomic filesystem rename (`fs.renameSync`).
   - Versioned envelope with SHA-256 integrity checksum to detect tampering and disk corruption on read.
   - Strict write-once immutability (`DuplicateTraceError` on duplicate `traceId`).

## Consequences
- Verification traces reliably survive process restarts and server reboots, verified by automated reopen tests.
- Partial writes due to crashes or power loss are impossible because files are moved atomically.
- Corrupted files throw `CorruptedRecordError` rather than silently passing.
- An enterprise database adapter (e.g. PostgreSQL) can be implemented in future phases against the same `ITraceRepository` interface.
