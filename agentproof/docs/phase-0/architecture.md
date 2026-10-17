# AgentProof — Phase 0: Extensible Architecture

**Document Version:** 1.0.0  
**Status:** Approved Specification  
**Author:** Principal Software Architect & Systems Engineer  
**Scope:** Modular Monolith Architecture, Layer Boundaries, Dependency Direction, Extensibility Model  

---

## 1. Architectural Style: Modular Monolith

AgentProof is architected as a **Modular Monolith** organized under Clean Architecture and Dependency Inversion principles. 

### Why a Modular Monolith?
1. **Zero Operational Overhead:** Eliminates network partitions, serialization latency, distributed tracing overhead, and container orchestration complexity during early research and MVP phases.
2. **Strict In-Process Boundaries:** Strong TypeScript interfaces and compilation boundaries enforce strict separation of concerns while running within a single, performant Node.js process.
3. **Frictionless Testing:** Enables sub-second unit and integration test runs across the entire verification pipeline in Vitest without managing multi-container test environments.
4. **Future Microservice Ready:** Because layers communicate exclusively via typed domain interfaces and command services, individual adapters or verification workers can be split into standalone services in future phases if scaling demands require it.

---

## 2. Layered Architecture & Dependency Direction

The core tenet of the architecture is the **Dependency Inversion Principle**:  
*High-level domain policies must never depend on low-level implementation details (such as NitroStack, HTTP transports, file systems, or databases). Both must depend on abstractions.*

```mermaid
graph TD
    subgraph Presentation_Layer [Presentation Layer / MCP Interface]
        MCP_Tools[NitroStack @Tool Controllers]
        MCP_Resources[NitroStack @Resource Handlers]
        MCP_Guards[Auth & Validation Guards]
    end

    subgraph Application_Layer [Application Layer]
        VerifService[Verification Application Service]
        TraceService[Trace Management Service]
        EvalService[Benchmark Evaluation Service]
    end

    subgraph Core_Domain [Core Domain (Zero External Dependencies)]
        RuleEngine[Deterministic Rule Engine]
        VerdictAggregator[Verdict Aggregator]
        DomainModels[Domain Contracts & Entities]
        DomainErrors[Domain Exceptions]
    end

    subgraph Infrastructure_Adapters [Adapters & Infrastructure Layer]
        StateReaders[IStateReader Implementations]
        ActionAdapters[IActionAdapter Implementations]
        StorageRepos[ITraceRepository Implementations]
        ConfigService[Configuration & Logging]
    end

    MCP_Tools --> VerifService
    MCP_Tools --> TraceService
    MCP_Tools --> EvalService

    VerifService --> Core_Domain
    TraceService --> Core_Domain
    EvalService --> Core_Domain

    VerifService --> StateReaders
    VerifService --> StorageRepos
    EvalService --> ActionAdapters

    StateReaders -.->|implements| DomainModels
    ActionAdapters -.->|implements| DomainModels
    StorageRepos -.->|implements| DomainModels
```

### Dependency Rules:
1. **Core Domain** has **NO dependencies** on NitroStack, Zod, Express, Node.js internals (beyond standard types), or database libraries.
2. **Application Layer** depends only on the **Core Domain** and abstract interfaces.
3. **Presentation Layer (MCP)** depends on the **Application Layer** to delegate requests. It handles input deserialization, NitroStack annotations (`@Tool`, `@Controller`), and execution context logging.
4. **Adapters & Storage** implement the interfaces defined in the Core and Application layers.

---

## 3. Structural Module Organization

Adapting to the existing NitroStack project structure (`c:\agentproof\agentproof\src`), the codebase will be organized into clean, purposeful directories:

```
c:\agentproof\agentproof\src/
├── core/                           # PURE DOMAIN (Zero Framework Dependencies)
│   ├── contracts/                  # Type definitions (Request, Action, Evidence, Result)
│   ├── verification/               # Deterministic rule engine & verdict aggregator
│   ├── predicates/                 # Pure evaluator functions (equals, delta, contains)
│   └── errors/                     # Domain exception hierarchy
│
├── application/                    # USE CASES & ORCHESTRATION
│   ├── services/
│   │   ├── verification.service.ts # Orchestrates reading state -> rule check -> verdict
│   │   ├── trace.service.ts        # Coordinates trace creation, redaction & retrieval
│   │   └── evaluation.service.ts   # Runs benchmark scenarios against ground truth
│   └── ports/                      # Secondary ports (IStateReader, ITraceRepo, etc.)
│
├── adapters/                       # DRIVERS & SECONDARY IMPLEMENTATIONS
│   ├── state/
│   │   ├── memory-state.reader.ts  # Deterministic in-memory datastore reader
│   │   └── state-reader.registry.ts# Dynamic registry of observation providers
│   ├── actions/
│   │   └── memory-action.adapter.ts# Deterministic test harness simulating agent tools
│   └── storage/
│       ├── in-memory-trace.repo.ts # Fast in-memory trace store for dev/testing
│       └── file-trace.repo.ts      # Optional JSON file persistence for inspectability
│
├── modules/                        # NITROSTACK MCP BINDINGS
│   ├── verification/
│   │   ├── verification.module.ts  # NitroStack @Module definition
│   │   └── verification.tools.ts   # @Tool decorators (verify_outcome, inspect_trace)
│   ├── scenarios/
│   │   ├── scenarios.module.ts     # NitroStack @Module for benchmark execution
│   │   └── scenarios.tools.ts      # @Tool decorators (list_scenarios, run_scenario)
│   └── calculator/                 # (Existing template module preserved for validation)
│
├── health/
│   └── system.health.ts            # Existing NitroStack health provider
├── app.module.ts                   # Root McpApp module importing verification modules
└── index.ts                        # NitroStack bootstrap entry point
```

---

## 4. Architectural Boundaries & Component Roles

### 4.1 Core Domain Layer
- **Responsibility:** Contains the immutable verification semantics, postcondition evaluation logic, tri-state aggregation rules, and reason code assignments.
- **Independence:** Can be compiled and executed in Node, Deno, Bun, or browser environments without modifications. It does not import `@nitrostack/core`.

### 4.2 Application Layer
- **Responsibility:** Implements application workflows:
  1. Validates preconditions.
  2. Resolves the appropriate `IStateReader` for the target resource.
  3. Executes the state acquisition and computes evidence integrity hashes.
  4. Invokes the core verification engine.
  5. Assembles and sanitizes the `VerificationTrace`.
  6. Persists the trace via `ITraceRepository`.
- **Decoupling:** Uses dependency injection to receive state readers and storage repositories.

### 4.3 MCP Presentation Layer
- **Responsibility:** Maps incoming MCP JSON-RPC tool calls to application service invocations and maps application outputs to standard MCP responses.
- **Isolation:** Contains zero business rules. If the MCP wire protocol changes or if an HTTP REST API is added in the future, the verification engine remains completely unaffected.

### 4.4 Adapters & Storage Layer
- **Responsibility:** Interacts with external systems, filesystems, and databases.
- **Pluggability:** In Phase 1–4, deterministic in-memory implementations provide millisecond-latency testing and reliable reproduction of failure scenarios. In future phases, PostgreSQL or live API adapters can be plugged in by implementing `IStateReader` or `ITraceRepository`.

---

## 5. Extension Mechanism (Adding Adapters Without Core Modifications)

To add a new state observation source (e.g., verifying a Stripe customer update or an AWS S3 bucket ACL change):

1. **Implement `IStateReader`:**
   ```typescript
   export class StripeCustomerStateReader implements IStateReader {
     readonly sourceId = 'stripe-billing-reader';
     canRead(target: ResourceTarget): boolean {
       return target.system === 'stripe' && target.resourceType === 'customer';
     }
     async readState(target: ResourceTarget): Promise<Evidence> {
       const customer = await stripeClient.customers.retrieve(target.resourceId);
       return {
         evidenceId: crypto.randomUUID(),
         evidenceType: 'STATE_SNAPSHOT',
         sourceId: this.sourceId,
         sourceKind: 'EXTERNAL_API',
         target,
         observedPayload: customer,
         observedAt: new Date().toISOString(),
         freshnessMs: 120,
         integrityHash: hashPayload(customer),
         limitations: ['Subject to Stripe API rate limits']
       };
     }
   }
   ```
2. **Register in `StateReaderRegistry`:**
   The reader is registered with the DI container during application bootstrap.
3. **Execute Verification:**
   When a verification request arrives with `target.system === 'stripe'`, the registry automatically routes observation acquisition to the Stripe reader.
4. **Core Invariance:**
   The `RuleEngine`, `VerdictAggregator`, and MCP controllers require **zero code changes**.
