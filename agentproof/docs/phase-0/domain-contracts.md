# AgentProof — Phase 0: Domain Contracts & Type Design

**Document Version:** 1.0.0  
**Status:** Approved Specification  
**Author:** Software Architect & Type Systems Specialist  
**Scope:** Domain Entities, Type Sketches, Zod Schemas, Extension Interfaces  

---

## 1. Design Philosophy

The AgentProof domain model is designed with the following constraints:
1. **Zero External Framework Dependencies:** Core contracts and interfaces are pure TypeScript types and Zod schemas. They do not depend on `@nitrostack/core`, HTTP frameworks, or specific database drivers.
2. **Strict Immutability:** All domain payloads and trace entities represent immutable historical facts.
3. **Cryptographic & Freshness Integrity:** Observations and traces include hashes and microsecond-precision ISO-8601 timestamps to support auditing and replay.
4. **Defensive Typing:** Domain entities explicitly capture execution status, sanitization markers, and evidence limitations to prevent poisoning from untrusted tool responses.

---

## 2. Core Domain Entities

```
┌────────────────────────────────────────────────────────┐
│                   VerificationRequest                  │
│  - target: ResourceTarget                              │
│  - intent: IntentDeclaration                           │
│  - preconditions: ConditionSpec[]                      │
│  - postconditions: ConditionSpec[]                     │
│  - policy: VerificationPolicy                          │
└───────────┬────────────────────────────────┬───────────┘
            │                                │
            ▼                                ▼
┌───────────────────────┐       ┌────────────────────────┐
│     ActionRecord      │       │        Evidence        │
│  - toolName           │       │  - sourceId            │
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
              │  - reasonCodes[]          │
              └─────────────┬─────────────┘
                            │
                            ▼
              ┌───────────────────────────┐
              │     VerificationTrace     │
              │  - traceId                │
              │  - linked request/result  │
              └───────────────────────────┘
```

### 2.1 ResourceTarget & IntentDeclaration
```typescript
/**
 * Uniquely identifies the physical or logical entity being verified.
 */
export interface ResourceTarget {
  readonly system: string;         // e.g., 'billing_service', 'customer_db'
  readonly resourceType: string;   // e.g., 'subscription', 'invoice', 'user'
  readonly resourceId: string;     // e.g., 'sub_c791'
  readonly tenantId?: string;      // e.g., 'org_marketing'
}

/**
 * Declares the semantic goal of the agent's action.
 */
export interface IntentDeclaration {
  readonly operation: string;              // e.g., 'upgrade_subscription'
  readonly summary: string;                // e.g., 'Upgrade customer to Pro plan with 10 seats'
  readonly expectedChanges: Record<string, unknown>; // e.g., { tier: 'pro', max_seats: 10 }
}
```

### 2.2 ConditionSpec (Preconditions & Postconditions)
```typescript
export type PredicateOperator = 
  | 'EQUALS' 
  | 'NOT_EQUALS' 
  | 'GREATER_THAN' 
  | 'LESS_THAN' 
  | 'CONTAINS' 
  | 'MATCHES_REGEX' 
  | 'EXISTS' 
  | 'DOES_NOT_EXIST';

export type ConditionEnforcement = 'REQUIRED' | 'ADVISORY';

export interface ConditionSpec {
  readonly id: string;                     // e.g., 'cond_tier_is_pro'
  readonly description: string;            // e.g., 'Subscription tier must be set to pro'
  readonly path: string;                   // JSONPath or dot notation, e.g., 'tier'
  readonly operator: PredicateOperator;
  readonly expectedValue?: unknown;        // e.g., 'pro'
  readonly enforcement: ConditionEnforcement; // Default: 'REQUIRED'
}
```

### 2.3 VerificationRequest
```typescript
export interface VerificationPolicy {
  readonly timeoutMs: number;              // e.g., 5000
  readonly requireIndependentSource: boolean; // Must be true in production
  readonly freshnessToleranceMs: number;   // Max age of observation in ms
}

export interface VerificationRequest {
  readonly schemaVersion: '1.0.0';
  readonly requestId: string;              // UUID v4
  readonly timestamp: string;              // ISO-8601
  readonly target: ResourceTarget;
  readonly intent: IntentDeclaration;
  readonly preconditions: readonly ConditionSpec[];
  readonly postconditions: readonly ConditionSpec[];
  readonly policy: VerificationPolicy;
  readonly metadata?: Record<string, unknown>;
}
```

### 2.4 ActionRecord
```typescript
export type ActionExecutionStatus = 
  | 'REPORTED_SUCCESS' 
  | 'REPORTED_FAILURE' 
  | 'ERRORED' 
  | 'UNKNOWN';

export interface ActionRecord {
  readonly actionId: string;               // UUID v4
  readonly toolName: string;               // e.g., 'update_subscription'
  readonly target: ResourceTarget;
  readonly sanitizedArgs: Record<string, unknown>; // Stripped of credentials
  readonly executionStatus: ActionExecutionStatus; // Unverified self-report
  readonly reportedResult: unknown;        // Raw or sanitized tool response
  readonly invokedAt: string;              // ISO-8601
  readonly completedAt: string;            // ISO-8601
  readonly agentId?: string;               // Identifier of the acting agent
}
```

### 2.5 Evidence
```typescript
export type EvidenceType = 
  | 'STATE_SNAPSHOT' 
  | 'EVENT_LOG' 
  | 'AUDIT_RECEIPT' 
  | 'SYSTEM_DIFF';

export interface Evidence {
  readonly evidenceId: string;             // UUID v4
  readonly evidenceType: EvidenceType;
  readonly sourceId: string;               // e.g., 'adapter:in-memory-db'
  readonly sourceKind: 'DIRECT_READ' | 'REPLICA_READ' | 'EVENT_STREAM' | 'EXTERNAL_API';
  readonly target: ResourceTarget;
  readonly observedPayload: unknown;       // Ground truth snapshot
  readonly observedAt: string;             // ISO-8601
  readonly freshnessMs: number;            // Time between action and observation
  readonly integrityHash: string;          // SHA-256 hash of observedPayload
  readonly limitations: readonly string[]; // Any known adapter caveats
}
```

### 2.6 ConditionEvaluation & VerificationResult
```typescript
export type Verdict = 'PASS' | 'FAIL' | 'INCONCLUSIVE';

export interface ConditionEvaluation {
  readonly conditionId: string;
  readonly description: string;
  readonly verdict: Verdict;
  readonly reasonCode: string;
  readonly explanation: string;
  readonly expected: unknown;
  readonly observed: unknown;
  readonly supportingEvidenceId?: string;
}

export interface VerificationResult {
  readonly schemaVersion: '1.0.0';
  readonly verificationId: string;         // UUID v4
  readonly requestId: string;              // Linked VerificationRequest ID
  readonly overallVerdict: Verdict;
  readonly summary: string;
  readonly evaluatedAt: string;            // ISO-8601
  readonly conditionEvaluations: readonly ConditionEvaluation[];
  readonly evidenceManifest: readonly {
    readonly evidenceId: string;
    readonly sourceId: string;
    readonly observedAt: string;
    readonly integrityHash: string;
  }[];
  readonly verifierIdentity: {
    readonly name: string;                 // 'AgentProof-Core'
    readonly version: string;              // '1.0.0'
  };
  readonly executionDurationMs: number;
}
```

### 2.7 VerificationTrace
```typescript
export interface VerificationTrace {
  readonly traceId: string;                // UUID v4
  readonly request: VerificationRequest;
  readonly action?: ActionRecord;
  readonly evidence: readonly Evidence[];
  readonly result: VerificationResult;
  readonly recordedAt: string;             // ISO-8601
}
```

---

## 3. Extension Interfaces

AgentProof relies on explicit, strongly-typed interfaces to decouple the verification core from observation sources, execution harnesses, and persistence providers.

### 3.1 `IVerifier`
- **Responsibility:** Evaluates a `VerificationRequest` against acquired `Evidence` and optional `ActionRecord` using deterministic rules.
- **Contract:**
  ```typescript
  export interface IVerifier {
    verify(
      request: VerificationRequest,
      evidence: readonly Evidence[],
      action?: ActionRecord
    ): Promise<VerificationResult>;
  }
  ```
- **Error Behavior:** Pure function execution. Throws `VerificationSchemaError` on invalid inputs; catches evaluation errors and converts them to `INCONCLUSIVE` results.
- **Extension Path:** Allows introducing specialized verifiers (e.g., temporal trace verifiers, differential fuzzing verifiers) without altering the application workflow.

### 3.2 `IStateReader` (Observation Provider)
- **Responsibility:** Independently retrieves the ground-truth state of a target resource directly from the underlying system.
- **Contract:**
  ```typescript
  export interface IStateReader {
    readonly sourceId: string;
    canRead(target: ResourceTarget): boolean;
    readState(target: ResourceTarget): Promise<Evidence>;
  }
  ```
- **Error Behavior:** Must throw structured exceptions (`StateReaderUnavailableError`, `StateReaderAuthError`, `ResourceNotFoundError`). The caller translates these into `INCONCLUSIVE` verdicts.
- **Registration Approach:** Registered in a `StateReaderRegistry` during application bootstrapping.
- **Extension Path:** Allows seamless addition of PostgreSQL readers, REST API readers, Redis readers, or Kubernetes readers.

### 3.3 `IActionAdapter` (Test Harness & Simulation)
- **Responsibility:** Executes or simulates agent actions in controlled environments to support testing and benchmark evaluation.
- **Contract:**
  ```typescript
  export interface IActionAdapter {
    readonly supportedTools: readonly string[];
    executeAction(
      toolName: string, 
      args: Record<string, unknown>, 
      mode: 'GENUINE_SUCCESS' | 'FALSE_SUCCESS' | 'MUTATION_FAILURE'
    ): Promise<ActionRecord>;
  }
  ```
- **Error Behavior:** Returns an `ActionRecord` with status `ERRORED` or `REPORTED_FAILURE` rather than throwing uncaught exceptions.
- **Extension Path:** Enables swapping between in-memory mock adapters and real external sandbox adapters.

### 3.4 `ITraceRepository`
- **Responsibility:** Persists and queries immutable `VerificationTrace` records.
- **Contract:**
  ```typescript
  export interface ITraceRepository {
    saveTrace(trace: VerificationTrace): Promise<void>;
    getTraceById(traceId: string): Promise<VerificationTrace | null>;
    listTraces(filter?: {
      targetId?: string;
      verdict?: Verdict;
      limit?: number;
    }): Promise<readonly VerificationTrace[]>;
  }
  ```
- **Error Behavior:** Throws `StorageError` on I/O or serialization failures.
- **Extension Path:** In-memory store for MVP $\rightarrow$ Local JSON files $\rightarrow$ PostgreSQL with Drizzle ORM in future phases.

### 3.5 `IScenarioProvider`
- **Responsibility:** Supplies predefined, deterministic benchmark scenarios with known ground truth.
- **Contract:**
  ```typescript
  export interface EvaluationScenario {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly target: ResourceTarget;
    readonly requestedAction: {
      readonly toolName: string;
      readonly args: Record<string, unknown>;
    };
    readonly expectedOutcome: IntentDeclaration;
    readonly injectedFailureMode?: 'NONE' | 'FALSE_SUCCESS' | 'WRONG_TARGET' | 'PARTIAL_UPDATE';
    readonly groundTruthVerdict: Verdict;
  }

  export interface IScenarioProvider {
    getScenario(id: string): Promise<EvaluationScenario | null>;
    listScenarios(): Promise<readonly EvaluationScenario[]>;
  }
  ```

---

## 4. Contract Justification Matrix

| Interface / Contract | Architectural Justification |
| :--- | :--- |
| **`IVerifier`** | Decouples the rule evaluation algorithm from NitroStack tools and HTTP endpoints. Enables offline unit testing of verification logic without server overhead. |
| **`IStateReader`** | Enforces the core premise of AgentProof: observations must be pluggable and acquired independently from the agent's tool execution channel. |
| **`ITraceRepository`** | Guarantees that persistence can transition from in-memory arrays to PostgreSQL without touching core verification services. |
| **`IScenarioProvider`** | Ensures reproducible benchmark evaluation by isolating test fixtures from application controllers. |
