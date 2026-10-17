# AgentProof — Phase 0: Data, Storage & Observability

**Document Version:** 1.0.0  
**Status:** Approved Specification  
**Author:** Principal Infrastructure & Data Architect  
**Scope:** Persistence Strategy, Trace Lifecycle, Logging Standards, Future Database Migration  

---

## 1. MVP Persistence Strategy

To maximize development velocity, maintain absolute determinism in testing, and eliminate external database provisioning overhead, the **MVP persistence strategy** is defined as:

1. **Primary Runtime Storage (In-Memory Repository):**
   - Verification traces and scenario states are maintained in thread-safe, in-memory collections (`Map<string, VerificationTrace>`).
   - Ensures sub-millisecond read/write latency during testing and local MCP interactions.
2. **Deterministic File-Based Fixtures (JSON):**
   - Benchmark scenarios and initial customer state records are stored as immutable JSON fixture files under `fixtures/scenarios/`.
   - Tests reset to known pristine state before each run.
3. **Optional Trace Snapshotting (Local Disk):**
   - When configured via `AGENTPROOF_PERSIST_TRACES=true`, completed traces are asynchronously written to `.traces/<trace_id>.json` for manual inspection and debugging.
4. **Deferred Technologies:**
   - PostgreSQL, Drizzle ORM, Prisma, Redis, and vector stores are **strictly deferred** from the initial MVP. No database containers are required to run or test AgentProof.

---

## 2. Trace Lifecycle & Immutability

A `VerificationTrace` represents an immutable record of historical truth.

```
┌────────────────────────────────────────────────────────┐
│                   TRACE LIFECYCLE                      │
├────────────────────────────────────────────────────────┤
│ 1. CREATION (Application Service)                      │
│    - Assigns UUID v4 trace_id                          │
│    - Attaches ISO-8601 UTC microsecond timestamp       │
│    - Attaches schema_version: "1.0.0"                  │
├────────────────────────────────────────────────────────┤
│ 2. EVIDENCE ACCRUAL                                    │
│    - Ingests raw state observation                     │
│    - Computes SHA-256 payload integrity hash           │
│    - Records source adapter ID and freshness latency   │
├────────────────────────────────────────────────────────┤
│ 3. SANITIZATION & REDACTION                            │
│    - Redacts authorization headers, tokens, passwords  │
│    - Masks PII according to privacy policy             │
├────────────────────────────────────────────────────────┤
│ 4. FINALIZATION                                        │
│    - Appends ConditionEvaluation results & reason codes│
│    - Locks record as immutable (Object.freeze)         │
├────────────────────────────────────────────────────────┤
│ 5. PERSISTENCE                                         │
│    - Writes to ITraceRepository                        │
└────────────────────────────────────────────────────────┘
```

---

## 3. The Future Storage Contract (`ITraceRepository`)

To guarantee that a future migration to PostgreSQL or Cloud SQL requires **zero changes** to the verification engine or MCP tools, storage is abstracted behind the `ITraceRepository` port:

```typescript
export interface TraceFilter {
  readonly targetSystem?: string;
  readonly targetResourceId?: string;
  readonly verdict?: 'PASS' | 'FAIL' | 'INCONCLUSIVE';
  readonly fromTimestamp?: string;
  readonly toTimestamp?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export interface ITraceRepository {
  /**
   * Persists an immutable verification trace.
   */
  saveTrace(trace: VerificationTrace): Promise<void>;

  /**
   * Retrieves a trace by its unique UUID.
   */
  getTraceById(traceId: string): Promise<VerificationTrace | null>;

  /**
   * Queries traces matching filter criteria.
   */
  findTraces(filter: TraceFilter): Promise<readonly VerificationTrace[]>;

  /**
   * Returns count of stored traces.
   */
  countTraces(filter?: TraceFilter): Promise<number>;
}
```

### Future PostgreSQL Migration Path (Phase 7):
When PostgreSQL is introduced, an adapter `PostgresTraceRepository` implementing `ITraceRepository` will be registered in `src/app.module.ts`. The schema will map directly:
- `trace_id` $\rightarrow$ `UUID PRIMARY KEY`
- `recorded_at` $\rightarrow$ `TIMESTAMPTZ`
- `target` $\rightarrow$ `JSONB` (indexed via GIN)
- `verdict` $\rightarrow$ `VARCHAR(20)` (indexed via B-tree)
- `payload` $\rightarrow$ `JSONB`

---

## 4. Observability & Safe Logging Standards

All logging within AgentProof adheres to structured JSON logging practices via NitroStack's `ExecutionContext.logger`:

### 4.1 Log Levels
- **`debug`:** Fine-grained predicate comparisons and raw adapter payloads.
- **`info`:** Request receipt, verdict emission, scenario completion.
- **`warn`:** Stale evidence detected, unexpected adapter latency, advisory condition failures.
- **`error`:** Unhandled exceptions, state reader timeouts, schema violations.

### 4.2 Mandatory Context Fields
Every log entry emitted by verification services must include:
```json
{
  "timestamp": "2026-10-17T12:00:00.000Z",
  "level": "info",
  "traceId": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "target": "billing_service:subscription:sub_c791",
  "verdict": "FAIL",
  "reasonCode": "FAIL_VALUE_MISMATCH",
  "durationMs": 42
}
```

### 4.3 Redaction Guarantees
- No `Authorization` headers or bearer tokens may ever appear in log strings.
- Passwords, API keys, and client secrets are stripped before logging.
