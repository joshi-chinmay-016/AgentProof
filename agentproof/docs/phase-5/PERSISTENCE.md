# AgentProof — Persistence Specification

## 1. Storage Backend Selection & Rationale

### Selection: `FileTraceRepository`
For Phase 5, AgentProof implements an atomic, filesystem-backed repository (`FileTraceRepository`) alongside the in-memory repository (`InMemoryTraceRepository`).

### Rationale
1. **Zero Native Dependencies:** Pure Node.js standard library (`node:fs`, `node:path`, `node:crypto`). Avoids native C++ compilation issues on Windows and diverse deployment environments.
2. **Durability Across Restarts:** Persists traces reliably across process restarts, proven by automated reopen tests.
3. **Crash Safety:** Implements write-ahead temporary files (`.tmp-<traceId>-<uuid>`) followed by atomic filesystem renames (`fs.renameSync`). Partial or interrupted writes never produce corrupted trace files.
4. **Physical Tenant Partitioning:** Each tenant has an independent directory (`<storageDir>/tenants/<tenantId>/`). Cross-tenant directory traversal is prevented via strict alphanumeric identifier sanitization.
5. **Cryptographic Checksumming:** Each stored record is wrapped in a versioned envelope containing an explicit SHA-256 digest of the trace content. Disk corruption or external tampering is detected immediately upon read.

---

## 2. Storage Data Model

### Envelope Specification
```typescript
export interface StoredTraceEnvelope {
  readonly schemaVersion: string; // e.g. '1.0.0'
  readonly traceId: string;
  readonly tenantId: string;
  readonly storedAt: string; // ISO-8601
  readonly checksum: string; // SHA-256 of canonical payload
  readonly trace: VerificationTrace;
}
```

### Filesystem Layout
```
.agentproof/data/traces/
├── .initialized
└── tenants/
    ├── tenant-alpha/
    │   ├── 1575c83b-b0f6-4592-8358-6a0ab64e53ce.json
    │   └── e49a022b-8b29-4b1f-99e2-e19273c52e41.json
    ├── tenant-beta/
    │   └── 9c83b482-1d54-4f01-8b01-a1b2c3d4e5f6.json
    └── default/
        └── ce60dc6f-e217-40ff-91e2-78bf53eda271.json
```

---

## 3. Durability Guarantees

1. **Write-Once Immutability:** Once written, traces cannot be modified or overwritten. Re-saving an existing `traceId` throws `DuplicateTraceError`.
2. **Atomic Writes:** Files are written to temporary staging files first and moved atomically to destination filenames.
3. **Integrity Verification on Read:** Every read recomputes the SHA-256 digest of the payload and compares it with `envelope.checksum`. Tampering or truncated files throw `CorruptedRecordError`.
4. **Tenant Scoping:** `getByTenantAndId(tenantId, traceId)` only searches `<storageDir>/tenants/<tenantId>/`. It cannot view or read records belonging to other tenants.
5. **No Silent Downgrade:** If storage write fails, the error bubbles up; the application never silently pretends that a volatile in-memory copy constitutes an audited durable record.

---

## 4. Migration & Evolution Strategy

- Schema versions are tracked in `envelope.schemaVersion` (currently `'1.0.0'`).
- The repository initialization checks `.initialized` marker file.
- Future schema migrations can read older envelope versions and upgrade them in-place or via background migration workers.
