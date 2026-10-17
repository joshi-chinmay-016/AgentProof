# AgentProof — Phase 1: NitroStack Foundation & Test Harness

**Document Version:** 1.0.0  
**Status:** Completed & Validated  
**Author:** Senior TypeScript Engineer & Testing Specialist  
**Milestone:** Phase 1 (NitroStack Foundation & Test Harness)  

---

## A. Purpose

Phase 1 establishes a reliable, deterministic automated testing foundation for **AgentProof** while strictly preserving the existing NitroStack MCP starter application.

Prior to Phase 1, the repository contained no automated test runner or test scripts. Introducing Vitest at this stage ensures that all subsequent domain logic (Phase 2), simulated environments (Phase 3), and MCP tool workflows (Phase 4) can be developed and verified using test-driven development (TDD) with sub-second execution cycles.

---

## B. Files Created & Modified

| File | Change Type | Rationale |
| :--- | :---: | :--- |
| [`agentproof/package.json`](file:///c:/agentproof/agentproof/package.json) | Modified | Added `"test": "vitest run"` script and added `"vitest": "^4.1.12"` to `devDependencies`. Preserved all existing scripts and dependencies. |
| [`agentproof/package-lock.json`](file:///c:/agentproof/agentproof/package-lock.json) | Modified | Updated lockfile to reflect the addition of Vitest and its dependencies. |
| [`agentproof/vitest.config.ts`](file:///c:/agentproof/agentproof/vitest.config.ts) | Created | Configured Vitest to run in `node` environment, discover tests under `tests/**/*.test.ts`, and exclude `node_modules`, `dist`, and `src/widgets`. |
| [`agentproof/tests/foundation.test.ts`](file:///c:/agentproof/agentproof/tests/foundation.test.ts) | Created | Implemented deterministic foundation smoke tests verifying test runner discovery, TypeScript execution, and Node.js runtime compatibility. |
| [`agentproof/.gitignore`](file:///c:/agentproof/agentproof/.gitignore) | Modified | Added `powershell.cmd` to prevent accidental commit of the local Windows tool runner execution shim. |
| [`agentproof/docs/phase-1/README.md`](file:///c:/agentproof/agentproof/docs/phase-1/README.md) | Created | Complete technical documentation of the Phase 1 test setup, validation results, and scope boundaries. |

---

## C. Test Setup & Architecture

### 1. Test Runner
- **Runner:** **Vitest** (v4.1.12)
- **Environment:** `node` (Node.js v20.20.2 LTS)
- **Execution Mode:** Single-run headless execution (`vitest run`). Watch mode is not triggered by default.

### 2. Test File Location
All automated tests reside under the `tests/` directory within the application root:
```
c:\agentproof\agentproof/
└── tests/
    └── foundation.test.ts
```

### 3. Vitest Configuration (`vitest.config.ts`)
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/src/widgets/**',
      '**/.next/**',
    ],
  },
});
```
- **Isolation:** Configured to strictly isolate unit and integration tests from production output (`dist/`) and the Next.js widget subproject (`src/widgets/`).
- **Build Coexistence:** Because `tsconfig.json` specifies `"rootDir": "./src"` and `"include": ["src/**/*"]`, test files in `tests/` are completely ignored by `nitrostack-cli build`, ensuring zero collision with the MCP production compiler.

### 4. How to Add a New Test
1. Create a `.test.ts` file in `agentproof/tests/` (e.g., `tests/unit/rule-engine.test.ts`).
2. Import test utilities from `vitest`:
   ```typescript
   import { describe, it, expect } from 'vitest';
   ```
3. Run `npm test` to execute the suite.

### 5. Smoke Test Verification
[`tests/foundation.test.ts`](file:///c:/agentproof/agentproof/tests/foundation.test.ts) performs four deterministic checks:
1. Vitest test runner discovers and executes test cases.
2. TypeScript types, interfaces, and assertions execute properly.
3. Node.js built-in runtime modules (`node:os`, `node:path`) operate as expected.
4. Pure TypeScript mathematical and delta assertions compute deterministically.

A temporary isolated experiment confirmed that a failing assertion triggers a non-zero exit code (`code 1`) as required.

---

## D. Working Commands

All commands must be executed from the application root: `c:\agentproof\agentproof`.

### 1. Fresh Checkout Setup
```powershell
cd c:\agentproof\agentproof
npm install --legacy-peer-deps
```

### 2. Execute Automated Tests
```powershell
npm test
```
*Executes `vitest run`, prints results to terminal, and exits with 0 on pass or 1 on failure.*

### 3. Build MCP Production Server & Widgets
```powershell
npm run build
```
*Compiles the Next.js widget in `src/widgets/out/` and compiles TypeScript into `dist/`.*

### 4. Run Development Server
```powershell
npm run dev
```
*Spawns `nitrostack-cli dev` in watch mode with the companion widget dev server on port 3001.*

---

## E. Actual Validation Results

Validation was executed directly in `c:\agentproof\agentproof`:

### 1. Test Suite (`npm test`)
```
> agentproof@1.0.0 test
> vitest run

 RUN  v4.1.12 C:/agentproof/agentproof

 ✓ tests/foundation.test.ts (4 tests) 6ms

 Test Files  1 passed (1)
      Tests  4 passed (4)
   Start at  12:23:00
   Duration  288ms (transform 24ms, setup 0ms, import 44ms, tests 6ms, environment 0ms)
```
- **Exit Code:** `0`
- **Result:** 1 test file passed, 4 test cases passed, 0 failures.

### 2. Production Build (`npm run build`)
```
> agentproof@1.0.0 build
> nitrostack-cli build

┌──────────────────────────────────────────────────────────────────┐
│  NITROSTACK ─ Build                                              │
│  Production bundle                                               │
└──────────────────────────────────────────────────────────────────┘

- Bundling widgets...
√ ✓ Widgets bundled (1 widgets)
- Compiling TypeScript...
√ ✓ TypeScript compiled

┌──────────────────────────────────────────────────────────────────┐
│  ✓ Build Complete (5.8s)                                         │
│                                                                  │
│    src/widgets/out/ (1 widgets)                                  │
│    dist                                                          │
└──────────────────────────────────────────────────────────────────┘
```
- **Exit Code:** `0`
- **Result:** Successfully built Next.js widget bundle and compiled TypeScript to `dist/` with zero compiler or module-resolution errors.

---

## F. Scope Boundaries

In accordance with the Phase 1 specification, the following capabilities are **explicitly deferred** to subsequent phases:
- ❌ The AgentProof verification engine (`src/core/verification`).
- ❌ The simulated subscription record-management environment.
- ❌ Independent state readers and evidence evaluation.
- ❌ Business-level MCP verification tools (`verify_outcome`, `inspect_trace`, `list_scenarios`, `run_scenario`).
- ❌ Trace repositories and benchmark execution runners.

---

## G. Next Milestone: Phase 2

With the foundation established and validated, the project is ready for **Phase 2: Core Verification Engine**.

**Phase 2 Objectives:**
1. Implement the pure TypeScript domain models under `src/core/contracts/` (`VerificationRequest`, `Evidence`, `VerificationResult`).
2. Implement deterministic predicate evaluators (`src/core/predicates/`).
3. Implement the tri-state `VerdictAggregator` (`PASS`, `FAIL`, `INCONCLUSIVE`) per the Phase 0 specification.
4. Implement the 10 deterministic unit test cases outlined in `docs/phase-0/testing-and-evaluation.md`.
