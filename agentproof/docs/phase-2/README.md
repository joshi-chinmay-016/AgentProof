# AgentProof — Phase 2: Core Verification Engine

**Document Version:** 1.0.0  
**Status:** Completed & Validated  
**Author:** Senior TypeScript Architect & Reliability Engineer  
**Milestone:** Phase 2 (Deterministic Core Verification Engine)  

---

## 1. Purpose & Scope

Phase 2 establishes the pure, deterministic verification domain for **AgentProof**. It directly addresses the **Verification Gap**: the reality that an AI agent or tool reporting `{ "status": "success" }` does not guarantee that the intended outcome occurred in ground truth.

### Key Scope Guarantees:
- **Zero Framework Coupling:** The core domain (`src/core/`) has **zero dependencies** on `@nitrostack/core`, HTTP frameworks, databases, or external network clients.
- **Deterministic Truth Authority:** Outcomes are evaluated strictly via typed logical and mathematical predicates against empirical evidence snapshots, rejecting probabilistic LLM pseudo-confidence scoring.
- **Epistemic Honesty:** The system implements a formal tri-state verdict model (`PASS`, `FAIL`, `INCONCLUSIVE`), ensuring that missing, stale, or conflicting observations never silently pass or false-alarm as failures.

---

## 2. Core Architecture & Module Organization

The verification core is located in [`agentproof/src/core/`](file:///c:/agentproof/agentproof/src/core) and structured into clean, single-responsibility modules:

```
agentproof/src/core/
├── domain/                         # Domain Entities & Value Objects (with Zod schemas)
│   ├── verification-request.ts     # Target, Intent, ConditionSpec, VerificationPolicy
│   ├── action-record.ts            # Claimed agent tool invocation and execution status
│   ├── evidence.ts                 # Observed payload, source metadata, integrity hash
│   ├── verification-result.ts      # Tri-state verdict, per-condition evaluations, manifest
│   └── verification-trace.ts       # Immutable audit trace tying request to result
├── contracts/                      # Secondary Interfaces & Ports
│   └── verifier.ts                 # IVerifier interface contract
├── verification/                   # Engine & Evaluators
│   ├── reason-codes.ts             # Standard machine-readable reason code constants
│   ├── condition-evaluator.ts      # Deterministic predicate evaluator & evidence matcher
│   ├── verdict-aggregator.ts       # Tri-state priority hierarchy aggregator
│   └── verification-engine.ts      # IVerifier implementation coordinating workflow
├── errors/                         # Domain Exception Hierarchy
│   └── domain-errors.ts            # VerificationDomainError, ValidationError, etc.
└── index.ts                        # Clean public API entry point
```

---

## 3. Domain Entities & Relationships

```
┌────────────────────────────────────────────────────────┐
│                   VerificationRequest                  │
│  - target: ResourceTarget (system, resourceType, id)   │
│  - intent: IntentDeclaration (operation, summary)      │
│  - preconditions: ConditionSpec[]                      │
│  - postconditions: ConditionSpec[]                     │
│  - policy: VerificationPolicy (freshness, timeout)     │
└───────────┬────────────────────────────────┬───────────┘
            │                                │
            ▼                                ▼
┌───────────────────────┐       ┌────────────────────────┐
│     ActionRecord      │       │        Evidence        │
│  - toolName           │       │  - sourceId / sourceKind│
│  - executionStatus    │       │  - observedPayload     │
│  - sanitizedArgs      │       │  - observedAt          │
│  - reportedResult     │       │  - integrityHash       │
└───────────┬───────────┘       └────────────┬───────────┘
            │                                │
            └───────────────┬────────────────┘
                            │
                            ▼
              ┌───────────────────────────┐
              │     VerificationResult    │
              │  - overallVerdict         │
              │  - conditionEvaluations[] │
              │  - evidenceManifest[]     │
              │  - executionDurationMs    │
              └─────────────┬─────────────┘
                            │
                            ▼
              ┌───────────────────────────┐
              │     VerificationTrace     │
              │  - traceId (UUID)         │
              │  - immutable audit log    │
              └───────────────────────────┘
```

---

## 4. Supported Postcondition Types

The `ConditionEvaluator` supports eight deterministic predicate operators:

| Operator | Target Types | Semantics |
| :--- | :--- | :--- |
| `EQUALS` | Any primitive, Object, Array | Deterministic deep equality comparison against `expectedValue`. Missing path yields `INCONCLUSIVE`. |
| `NOT_EQUALS` | Any primitive, Object, Array | Negated deep equality. Observed value must not equal `expectedValue`. |
| `GREATER_THAN` | Numbers | Evaluates `observedValue > expectedValue`. Non-numeric values yield `INCONCLUSIVE`. |
| `LESS_THAN` | Numbers | Evaluates `observedValue < expectedValue`. Non-numeric values yield `INCONCLUSIVE`. |
| `CONTAINS` | Strings, Arrays | String substring search or array membership (via deep equality). |
| `MATCHES_REGEX` | Strings | Regular expression testing. Invalid patterns yield `INCONCLUSIVE`. |
| `EXISTS` | Any | Asserts path is defined and non-null in observed payload. |
| `DOES_NOT_EXIST` | Any | Asserts path is undefined or null in observed payload. |

---

## 5. Tri-State Verdict Semantics & Priority Hierarchy

Every verification evaluation yields one of three mutually exclusive verdicts:

1. **`PASS`:** Every declared `REQUIRED` postcondition was confirmed satisfied by valid, fresh, relevant independent evidence.
2. **`FAIL`:** Reliable evidence conclusively proves that at least one `REQUIRED` postcondition or precondition was violated.
3. **`INCONCLUSIVE`:** Evidence is missing, stale, conflicting, or lacks required attributes to establish ground truth.

### Aggregation Truth Table (Priority: `FAIL` > `INCONCLUSIVE` > `PASS`)
| Any Required FAIL? | Any Required INCONCLUSIVE? | All Required PASS? | Overall Verdict | Primary Reason Code |
| :---: | :---: | :---: | :---: | :--- |
| **YES** | *Any* | *Any* | **`FAIL`** | Derived from the first failed condition |
| **NO** | **YES** | *Any* | **`INCONCLUSIVE`** | Derived from the first inconclusive condition |
| **NO** | **NO** | **YES** | **`PASS`** | `PASS_ALL_CONDITIONS_VERIFIED` |

---

## 6. Evidence Matching & Trust Principles

1. **Target Relevance:** Evidence is matched strictly against `target.system`, `target.resourceType`, `target.resourceId`, and `target.tenantId`. Unrelated evidence is ignored.
2. **Staleness Protection:** If an `ActionRecord` is provided, observations timestamped prior to `action.invokedAt` (beyond `freshnessToleranceMs`) are rejected with `INC_STALE_EVIDENCE`.
3. **Conflict Detection:** If multiple independent evidence sources observe contradictory values for the same property, the evaluator issues `INC_CONFLICTING_EVIDENCE`.
4. **Agent Claims are Untrusted:** A tool's `executionStatus: 'REPORTED_SUCCESS'` is never accepted as a substitute for independent evidence. In the absence of evidence, the verdict is `INCONCLUSIVE`.

---

## 7. Public Core API Usage

Callers consume the verification engine without importing any NitroStack framework classes:

```typescript
import {
  VerificationEngine,
  IVerifier,
  VerificationRequest,
  Evidence,
  ActionRecord
} from './src/core/index.js';

// 1. Instantiate engine
const verifier: IVerifier = new VerificationEngine();

// 2. Define verification request
const request: VerificationRequest = {
  schemaVersion: '1.0.0',
  requestId: 'req_101',
  timestamp: new Date().toISOString(),
  target: { system: 'billing_service', resourceType: 'subscription', resourceId: 'sub_c791' },
  intent: { operation: 'upgrade', summary: 'Upgrade to pro', expectedChanges: { tier: 'pro' } },
  preconditions: [],
  postconditions: [
    {
      id: 'post_tier_pro',
      description: 'Tier must be pro',
      path: 'tier',
      operator: 'EQUALS',
      expectedValue: 'pro',
      enforcement: 'REQUIRED'
    }
  ],
  policy: { timeoutMs: 5000, requireIndependentSource: true, freshnessToleranceMs: 60000 }
};

// 3. Provide independent evidence
const evidence: Evidence[] = [
  {
    evidenceId: 'ev_001',
    evidenceType: 'STATE_SNAPSHOT',
    sourceId: 'db_replica',
    sourceKind: 'DIRECT_READ',
    target: request.target,
    observedPayload: { subscription_id: 'sub_c791', tier: 'pro' },
    observedAt: new Date().toISOString(),
    freshnessMs: 40,
    integrityHash: 'sha256_mock_hash',
    limitations: []
  }
];

// 4. Verify
const result = await verifier.verify(request, evidence);
console.log(result.overallVerdict); // 'PASS'
```

---

## 8. Test Suite & Validation Results

### 1. Automated Tests (`npm test`)
```powershell
cd c:\agentproof\agentproof
npm test
```
**Actual Output:**
```
 RUN  v4.1.12 C:/agentproof/agentproof

 ✓ tests/foundation.test.ts (4 tests) 7ms
 ✓ tests/core/verdict-aggregator.test.ts (7 tests) 8ms
 ✓ tests/core/public-api.test.ts (3 tests) 13ms
 ✓ tests/core/condition-evaluator.test.ts (12 tests) 13ms
 ✓ tests/core/domain-contracts.test.ts (5 tests) 17ms
 ✓ tests/core/verification-engine.test.ts (8 tests) 30ms

 Test Files  6 passed (6)
      Tests  39 passed (39)
   Start at  12:31:49
   Duration  1.18s
```
- **Exit Code:** `0`
- **Result:** 39 passed tests across 6 suites, 0 failures.

### 2. Production Build (`npm run build`)
```powershell
npm run build
```
**Actual Output:**
```
- Bundling widgets...
√ ✓ Widgets bundled (1 widgets)
- Compiling TypeScript...
√ ✓ TypeScript compiled

┌──────────────────────────────────────────────────────────────────┐
│  ✓ Build Complete (15.7s)                                        │
│    src/widgets/out/ (1 widgets)                                  │
│    dist                                                          │
└──────────────────────────────────────────────────────────────────┘
```
- **Exit Code:** `0`
- **Result:** TypeScript compiled cleanly to `dist/` with zero compiler errors.

---

## 9. Scope Boundaries & Next Milestone

In accordance with the Phase 2 specification:
- ❌ The simulated record-management environment remains deferred to Phase 3.
- ❌ NitroStack controller tool bindings (`verify_outcome`, `inspect_trace`) remain deferred to Phase 4.
- ❌ Database storage (PostgreSQL) remains deferred to Phase 7.

### Next Milestone: Phase 3 (Simulated Environment & Failure Injection)
Phase 3 will introduce:
1. An in-memory subscription repository representing ground truth.
2. A configurable test harness capable of injecting failure modes (`FALSE_SUCCESS`, `WRONG_TARGET`, `PARTIAL_UPDATE`).
3. An `IStateReader` adapter that queries the in-memory store directly.
