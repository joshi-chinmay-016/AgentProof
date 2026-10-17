# External State Readers Specification

## 1. Interface and Responsibilities

Independent state readers provide the observation foundation for AgentProof, decoupling the agent's reported outcome from the ground truth established by external systems.

```typescript
export interface IExternalStateReader {
  readonly sourceId: string;
  readonly sourceType: 'REST_API' | 'POSTGRES' | 'S3_STORAGE' | 'SIMULATED';
  readonly integrationId: string;
  readonly tenantId: string;

  readState(target: ResourceTarget): Promise<ExternalObservationRecord>;
}
```

### Core Invariants
1. **Strictly Read-Only:** External readers must never mutate, insert, delete, or modify observed systems.
2. **Deterministic Status Taxonomy:** Every observation outcome maps to one of four strictly typed statuses: `FOUND`, `NOT_FOUND`, `READ_ERROR`, or `UNTRUSTED`.
3. **No Fabricated Evidence:** Observation failures never produce synthesized or fabricated payloads.
4. **Tenant Scoping:** Readers operate under explicit tenant boundaries and cannot observe across tenant partitions.

---

## 2. Observation Outcomes & Semantics

| Status | Meaning | Semantics | Resulting Action |
| :--- | :--- | :--- | :--- |
| `FOUND` | Resource exists and state was successfully retrieved | Payload contains observed properties. Digest computed deterministically. | Evaluated against condition postconditions (PASS or FAIL). |
| `NOT_FOUND` | Reliable confirmation that resource does not exist | Remote system explicitly confirms absence (e.g. HTTP 404 from authenticated endpoint, or 0 matching rows). | Can satisfy `DOES_NOT_EXIST` postconditions (PASS for deletion). Violates `EXISTS` conditions (FAIL). |
| `READ_ERROR` | Ground truth could not be established | Network timeout, rate limit (429), connection refused, auth failure (401/403), or malformed response. | Produces `INCONCLUSIVE` verdict (`INC_READER_TIMEOUT` or `INC_READER_ERROR`). **NEVER converts to NOT_FOUND.** |
| `UNTRUSTED` | Observation fails trust policy | Signature failure, unsupported digest, or unauthenticated source claim. | Produces `INCONCLUSIVE` (`INC_UNTRUSTED_EVIDENCE`). |

---

## 3. Absence Semantics (The Negative Proof Guarantee)

In distributed systems, the absence of proof is not proof of absence.
AgentProof enforces the following non-negotiable rules:

1. **HTTP 404 is NOT automatic proof of absence:** An HTTP 404 is accepted as `NOT_FOUND` ONLY when:
   - The connection was successfully authenticated.
   - The path is within the approved resource allowlist.
   - The remote source contract explicitly designates 404 as entity non-existence.
2. **Network Failures and Timeouts:** An HTTP 500, network drop, or connection timeout establishes that the reader cannot determine the state. It is recorded as `READ_ERROR` and leads to `INCONCLUSIVE`.
3. **Authentication Denials:** HTTP 401 or 403 responses indicate the reader lacks authorization, not that the resource does not exist. Recorded as `READ_ERROR` with `AUTHORIZATION_FAILURE`.
4. **Database Absence:** A database record is confirmed absent (`NOT_FOUND`) only when an authorized, parameterized `SELECT` query finishes execution successfully and returns exactly 0 matching rows.
