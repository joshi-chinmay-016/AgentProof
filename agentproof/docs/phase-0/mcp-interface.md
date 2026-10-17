# AgentProof — Phase 0: MCP Interface Specification

**Document Version:** 1.0.0  
**Status:** Approved Specification  
**Author:** Principal Software Architect & MCP Specialist  
**Scope:** Tool Schemas, Zod Definitions, Safety Contracts, Permissions, Error Models  

---

## 1. Overview & Protocol Conformance

This specification defines the Model Context Protocol (MCP) tool surface exposed by AgentProof. The tools are implemented in strict accordance with the `@nitrostack/core` decorator patterns and Zod runtime schema validations discovered in the application template.

### Architectural Principles:
1. **Separation of Concerns:** General-purpose verification tools (`verify_outcome`, `inspect_trace`) are decoupled from simulation and benchmark execution tools (`list_scenarios`, `run_scenario`).
2. **Defensive Isolation:** No tool exposes arbitrary shell commands, raw SQL strings, or unconstrained filesystem access.
3. **Idempotence & Safety:** Read-only inspection tools are guaranteed side-effect free. Verification requests are strictly read-only relative to the target system (they observe, but do not mutate target state).

---

## 2. Tool Catalog Summary

| Tool Name | Operation Mode | Mutates Target State? | Idempotent? | Description |
| :--- | :--- | :---: | :---: | :--- |
| `verify_outcome` | Core Verification | **NO** (Read-Only) | **YES** | Independently evaluates whether an agent's claimed outcome is backed by empirical state evidence. |
| `inspect_trace` | Audit & Diagnostics | **NO** (Read-Only) | **YES** | Retrieves an immutable verification audit trace by ID. |
| `list_scenarios` | Benchmark Discovery | **NO** (Read-Only) | **YES** | Returns the catalog of predefined, deterministic test scenarios. |
| `run_scenario` | Benchmark Execution | **Isolated Harness** | **YES** | Executes a controlled scenario in an isolated test harness and returns verification analysis. |

---

## 3. Tool Specifications

### 3.1 `verify_outcome`

#### Purpose
Independently queries an observation provider for the target resource, evaluates declared preconditions and postconditions, records an immutable verification trace, and returns an evidence-backed verdict (`PASS`, `FAIL`, or `INCONCLUSIVE`).

#### Input Schema (Zod Definition)
```typescript
import { z } from '@nitrostack/core';

export const VerifyOutcomeInputSchema = z.object({
  target: z.object({
    system: z.string().min(1).describe('Target system identifier, e.g. "billing_service"'),
    resource_type: z.string().min(1).describe('Entity type, e.g. "subscription"'),
    resource_id: z.string().min(1).describe('Unique entity identifier, e.g. "sub_c791"'),
    tenant_id: z.string().optional().describe('Optional tenant or organization identifier')
  }).describe('The target resource that was mutated'),
  
  intent: z.object({
    operation: z.string().min(1).describe('The operation attempted, e.g. "upgrade_subscription"'),
    summary: z.string().min(1).describe('Human-readable description of intended outcome'),
    expected_changes: z.record(z.any()).describe('Key-value pairs of expected state updates')
  }).describe('The intended outcome declared by the agent'),

  postconditions: z.array(z.object({
    id: z.string().min(1).describe('Unique condition identifier'),
    description: z.string().describe('Human-readable condition explanation'),
    path: z.string().min(1).describe('Object path in target state, e.g. "tier" or "settings.seats"'),
    operator: z.enum([
      'EQUALS', 
      'NOT_EQUALS', 
      'GREATER_THAN', 
      'LESS_THAN', 
      'CONTAINS', 
      'EXISTS', 
      'DOES_NOT_EXIST'
    ]).describe('Predicate operator'),
    expected_value: z.any().optional().describe('Expected value for comparison'),
    enforcement: z.enum(['REQUIRED', 'ADVISORY']).default('REQUIRED').describe('Condition strictness')
  })).min(1).describe('Postconditions that must be satisfied to verify outcome'),

  action_claim: z.object({
    tool_name: z.string().min(1).describe('Name of the tool the agent executed'),
    reported_status: z.enum(['success', 'failure', 'unknown']).describe('Status returned by the tool'),
    reported_payload: z.any().optional().describe('Response payload returned by the tool')
  }).optional().describe('Optional claim provided by the agent for audit correlation')
});
```

#### Output Schema (Zod Definition)
```typescript
export const VerifyOutcomeOutputSchema = z.object({
  verification_id: z.string().uuid(),
  trace_id: z.string().uuid(),
  verdict: z.enum(['PASS', 'FAIL', 'INCONCLUSIVE']),
  summary: z.string(),
  reason_code: z.string(),
  evaluated_at: z.string().datetime(),
  conditions_evaluated: z.array(z.object({
    id: z.string(),
    description: z.string(),
    verdict: z.enum(['PASS', 'FAIL', 'INCONCLUSIVE']),
    reason_code: z.string(),
    explanation: z.string(),
    expected: z.any().optional(),
    observed: z.any().optional()
  })),
  evidence_summary: z.object({
    source_id: z.string(),
    observed_at: z.string().datetime(),
    integrity_hash: z.string()
  })
});
```

#### Preconditions & Error Handling
- **Preconditions:** `target` must resolve to a known state reader adapter; at least one postcondition must be supplied.
- **Error Behavior:** 
  - Schema validation failure $\rightarrow$ NitroStack validation rejection.
  - State reader unreachable / timeout $\rightarrow$ Returns structured output with verdict `INCONCLUSIVE` and reason `INC_READER_TIMEOUT`. Does **not** crash the server.

---

### 3.2 `inspect_trace`

#### Purpose
Retrieves the complete historical audit trace for a specific verification execution, including sanitized request data, tool claims, raw evidence snapshots, cryptographic hashes, and per-condition evaluations.

#### Input Schema
```typescript
export const InspectTraceInputSchema = z.object({
  trace_id: z.string().uuid().describe('The UUID of the verification trace to retrieve')
});
```

#### Output Schema
```typescript
export const InspectTraceOutputSchema = z.object({
  found: z.boolean(),
  trace: z.object({
    trace_id: z.string().uuid(),
    recorded_at: z.string().datetime(),
    target: z.record(z.any()),
    intent: z.record(z.any()),
    verdict: z.enum(['PASS', 'FAIL', 'INCONCLUSIVE']),
    action_claim: z.record(z.any()).optional(),
    evidence: z.array(z.object({
      evidence_id: z.string(),
      source_id: z.string(),
      source_kind: z.string(),
      observed_payload: z.any(),
      observed_at: z.string(),
      integrity_hash: z.string()
    })),
    condition_evaluations: z.array(z.any())
  }).optional(),
  message: z.string().optional()
});
```

---

### 3.3 `list_scenarios`

#### Purpose
Lists all predefined benchmark scenarios available in the local evaluation catalog, including their scenario ID, description, target domain, and injected failure modes.

#### Input Schema
```typescript
export const ListScenariosInputSchema = z.object({
  domain_filter: z.string().optional().describe('Optional filter by domain, e.g. "subscription"')
});
```

#### Output Schema
```typescript
export const ListScenariosOutputSchema = z.object({
  scenarios: z.array(z.object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    domain: z.string(),
    injected_failure_mode: z.string(),
    ground_truth_verdict: z.enum(['PASS', 'FAIL', 'INCONCLUSIVE'])
  })),
  total_count: z.number()
});
```

---

### 3.4 `run_scenario`

#### Purpose
Executes a controlled benchmark scenario in an isolated test harness. Simulates the agent's action (including deliberate failure modes such as false success responses or silent mutation drops), acquires independent state, and invokes the verification engine to confirm that AgentProof correctly identifies the ground truth.

#### Input Schema
```typescript
export const RunScenarioInputSchema = z.object({
  scenario_id: z.string().min(1).describe('The ID of the scenario to execute, e.g. "subscription_false_success"')
});
```

#### Output Schema
```typescript
export const RunScenarioOutputSchema = z.object({
  scenario_id: z.string(),
  scenario_name: z.string(),
  ground_truth_verdict: z.enum(['PASS', 'FAIL', 'INCONCLUSIVE']),
  agentproof_verdict: z.enum(['PASS', 'FAIL', 'INCONCLUSIVE']),
  benchmark_matched: z.boolean().describe('True if AgentProof verdict matched ground truth'),
  agent_claimed_status: z.string(),
  explanation: z.string(),
  trace_id: z.string().uuid()
});
```

---

## 4. NitroStack Controller Implementation Skeleton

Following the exact NitroStack conventions observed in `src/modules/calculator/calculator.tools.ts`:

```typescript
import { ControllerDecorator as Controller, ToolDecorator as Tool, ExecutionContext } from '@nitrostack/core';
import { VerificationService } from '../../application/services/verification.service.js';
import { VerifyOutcomeInputSchema } from './schemas/verify-outcome.schema.js';

@Controller('verification')
export class VerificationTools {
  constructor(private readonly verificationService: VerificationService) {}

  @Tool({
    name: 'verify_outcome',
    description: 'Independently verify whether an agent tool action produced the intended outcome using ground-truth state.',
    inputSchema: VerifyOutcomeInputSchema
  })
  async verifyOutcome(input: any, ctx: ExecutionContext) {
    ctx.logger.info('Received verify_outcome request', {
      target: input.target,
      intent: input.intent.operation
    });

    const result = await this.verificationService.verify({
      target: input.target,
      intent: input.intent,
      postconditions: input.postconditions,
      actionClaim: input.action_claim
    });

    return result;
  }
}
```

---

## 5. Security & Access Boundary Constraints

1. **No Target Mutation:** MCP tools in AgentProof never issue write, update, or delete commands against external customer systems during verification. They are read-only observers.
2. **Credential Redaction:** Authentication tokens or passwords passed in `reported_payload` are stripped by sanitization pipes before inclusion in traces or logs.
3. **Execution Limits:** `verify_outcome` calls enforce a hard 5000ms timeout on state reader acquisitions to prevent resource exhaustion attacks against slow upstream APIs.
