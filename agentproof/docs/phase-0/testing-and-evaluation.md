# AgentProof — Phase 0: Test & Benchmark Strategy

**Document Version:** 1.0.0  
**Status:** Approved Specification  
**Author:** Quality Assurance Architect & Reliability Engineer  
**Scope:** Test Architecture, Deterministic Test Cases, Benchmark Suite, Metric Definitions  

---

## 1. Testing Philosophy & Vitest Adoption

AgentProof proves its reliability through deterministic, reproducible automated test suites. In Phase 1, **Vitest** will be integrated as the primary test runner because:
1. Native ES Module support matching the Node.js `"type": "module"` configuration.
2. Direct execution of TypeScript via Vite without manual precompilation.
3. Sub-second execution speeds enabling continuous test-driven development (TDD).
4. Full compatibility with Jest assertions and mocking utilities.

---

## 2. Test Suite Architecture

```
┌────────────────────────────────────────────────────────┐
│ TEST PYRAMID                                           │
├────────────────────────────────────────────────────────┤
│ Level 3: E2E Benchmark Suite                           │
│  - Executes predefined evaluation scenarios            │
│  - Compiles TP/FP/TN/FN metrics against ground truth   │
├────────────────────────────────────────────────────────┤
│ Level 2: Application Integration Tests                 │
│  - VerificationService + StateReader + In-Memory Repo  │
│  - Tests end-to-end trace assembly and persistence     │
├────────────────────────────────────────────────────────┤
│ Level 1: Deterministic Domain Unit Tests               │
│  - RuleEngine, Predicates, VerdictAggregator           │
│  - Zero I/O, pure in-memory execution                  │
└────────────────────────────────────────────────────────┘
```

---

## 3. The 10 Deterministic Unit Test Scenarios

The test suite will contain 10 specific test suites verifying exact verdict semantics:

| # | Scenario Name | Test Setup & Injected State | Expected Verdict | Expected Reason Code |
| :-: | :--- | :--- | :---: | :--- |
| **1** | **Correctly Completed Action** | Tool returns success; state reader observes `tier == 'pro'` and `seats == 10`. | `PASS` | `PASS_ALL_CONDITIONS_VERIFIED` |
| **2** | **False Success Response** | Tool returns `{ success: true }`; state reader observes `tier == 'free'` (unchanged). | `FAIL` | `FAIL_VALUE_MISMATCH` |
| **3** | **Wrong-Target Update** | Tool returns success; record for `sub_c791` is unchanged while `sub_c999` was mutated. | `FAIL` | `FAIL_TARGET_NOT_MODIFIED` |
| **4** | **Partial Update** | Tool returns success; state reader observes `tier == 'pro'` but `seats == 1` (expected 10). | `FAIL` | `FAIL_VALUE_MISMATCH` |
| **5** | **Violated Precondition** | Precondition requires `tier == 'free'`; state reader observes initial `tier == 'enterprise'`. | `FAIL` | `FAIL_PRECONDITION_VIOLATED` |
| **6** | **Missing Observation** | State reader returns null payload or resource not found. | `INCONCLUSIVE` | `INC_MISSING_ATTRIBUTES` |
| **7** | **Stale Observation** | Observation timestamp is 10 seconds older than action invocation timestamp. | `INCONCLUSIVE` | `INC_STALE_EVIDENCE` |
| **8** | **Conflicting Evidence** | Two observation adapters return different values for the same field without a tie-breaker. | `INCONCLUSIVE` | `INC_CONFLICTING_EVIDENCE` |
| **9** | **Failed State Reader** | State reader throws a network connection timeout (`ETIMEDOUT`). | `INCONCLUSIVE` | `INC_READER_TIMEOUT` |
| **10** | **Invalid Verification Request** | Request payload omits required fields or has malformed operator. | *Validation Error* | `ERR_SCHEMA_VALIDATION` |

---

## 4. Evaluation Benchmark Scenario Format

Evaluation scenarios are stored as deterministic fixtures to enable reproducible benchmark runs.

```typescript
export interface BenchmarkScenarioFixture {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly initial_state: {
    readonly subscription_id: string;
    readonly customer_id: string;
    readonly tier: 'free' | 'pro' | 'enterprise';
    readonly max_seats: number;
    readonly status: 'active' | 'suspended' | 'canceled';
  };
  readonly requested_action: {
    readonly tool_name: string;
    readonly input_args: Record<string, unknown>;
  };
  readonly injected_behavior: {
    readonly tool_reported_status: 'success' | 'failure';
    readonly state_mutation_applied: 'FULL' | 'NONE' | 'PARTIAL' | 'WRONG_RECORD';
  };
  readonly verification_spec: {
    readonly postconditions: Array<{
      readonly path: string;
      readonly operator: 'EQUALS';
      readonly expected_value: unknown;
    }>;
  };
  readonly ground_truth: {
    readonly expected_verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE';
    readonly expected_primary_reason: string;
  };
}
```

---

## 5. Benchmark Metrics & Mathematical Formulation

When evaluating AgentProof against a test distribution, metric definitions must be unambiguous.

### 5.1 Definition of "Positive"
In reliability engineering and safety verification, a **Positive Event** is defined as:
$$\text{Positive Event} = \text{Detection of an Unverified, Divergent, or Failed Action (Preventing a False Success)}$$

### 5.2 Confusion Matrix Mapping
| Reality (Ground Truth) \ Verifier Verdict | Verifier Detects Issue (`FAIL` / `INCONCLUSIVE`) | Verifier Declares Verified (`PASS`) |
| :--- | :---: | :---: |
| **Action Was Divergent / Unverified** | **True Positive (TP)**<br>*(Correctly caught false claim)* | **False Negative (FN)**<br>*(Dangerous: Allowed false claim)* |
| **Action Was Genuinely Successful** | **False Positive (FP)**<br>*(Spurious rejection of good update)* | **True Negative (TN)**<br>*(Correctly verified genuine success)* |

### 5.3 Mathematical Metrics
- **Precision:**
  $$\text{Precision} = \frac{\text{TP}}{\text{TP} + \text{FP}}$$
  *Measures: When AgentProof flags an action as unverified or failing, is it actually flawed?*

- **Recall (Sensitivity):**
  $$\text{Recall} = \frac{\text{TP}}{\text{TP} + \text{FN}}$$
  *Measures: Out of all false successes or corrupted mutations, what percentage did AgentProof intercept?*

- **Inconclusive Rate ($R_{\text{inc}}$):**
  $$R_{\text{inc}} = \frac{N_{\text{inconclusive}}}{N_{\text{total}}}$$
  *Measures: What percentage of verification attempts had insufficient evidence?*

- **Verification Latency Overhead ($\Delta T$):**
  $$\Delta T = T_{\text{end-to-end}} - T_{\text{action-execution}}$$
  *Measures: Additional latency introduced by independent state acquisition and rule evaluation.*

> [!WARNING]
> **Generalization Disclaimer:**
> Benchmark scores achieved in the controlled scenario suite reflect performance **only on the evaluated distribution of scenarios**. They do not constitute an empirical guarantee of general reliability across arbitrary, untested production systems.
