# AgentProof — Real Python Agent & REST Verification Integration

This directory contains the first real, end-to-end integration proving AgentProof's core promise:
**An AI agent claims it performed an action. AgentProof independently queries the actual REST service, deterministically evaluates postconditions against independent ground-truth evidence, persists the trace and audit chain, and displays an explainable PASS, FAIL, or INCONCLUSIVE result.**

---

## 1. Architecture & Workflow

```
[Python AI Agent]
       │
       │ 1. POST /customers (create customer resource)
       ▼
[Test Customer Service] ─── (State stored on real HTTP REST API)
       ▲
       │ 3. Independent GET /customers/{id} (Server-side API key, SSRF guarded)
       │
[AgentProof Platform]
  ├── POST /api/v1/verifications (Bearer token, tenant isolation)
  │     ├── ExternalSourceRegistry resolves 'customer-service-rest'
  │     ├── EnvironmentSecretProvider provides credentials
  │     ├── RestApiStateReader fetches ground truth
  │     ├── ExternalEvidenceAdapter converts to domain evidence
  │     ├── EvidenceTrustValidator enforces integrity
  │     ├── VerificationEngine computes authoritative verdict
  │     ├── FileTraceRepository & FileAuditEventRepository persist records
  │     └── Returns 201 Created with authoritative verdict
  └── GET /api/v1/verifications/:id (inspect result and evidence)
       ▲
       │ 4. Real-time inspectable via UI
[AgentProof Web Console] (http://localhost:3000/app)
```

---

## 2. Directory Structure

```
examples/
├── test-customer-service/
│   └── server.py             # Pure Python HTTP REST service (port 4000)
└── python-agent/
    └── agent_verify.py       # Autonomous Python agent client (stdlib urllib)
```

Both components use standard Python 3 with **zero third-party dependencies**.

---

## 3. Quickstart: Running the Live Integration

### Step 1: Start the Customer Service (Terminal 1)
```bash
python examples/test-customer-service/server.py
```
*Listens on `http://127.0.0.1:4000`. Authenticates requests via `x-api-key: test-customer-key`.*

### Step 2: Start AgentProof Web Console & Verification Engine (Terminal 2)
```bash
# From c:\agentproof\agentproof
npm run console
```
*Listens on `http://127.0.0.1:3000`. The authenticated verification API is exposed at `http://127.0.0.1:3000/api/v1/verifications`.*

### Step 3: Run the Python Agent (Terminal 3)
```bash
# Run all three scenarios (PASS, FAIL, INCONCLUSIVE)
python examples/python-agent/agent_verify.py --all

# Or run an individual scenario:
python examples/python-agent/agent_verify.py --scenario pass
python examples/python-agent/agent_verify.py --scenario fail
python examples/python-agent/agent_verify.py --scenario inc
```

---

## 4. Scenario Breakdown

| Scenario | Agent Action | Postconditions | Independent Evidence | Authoritative Verdict |
| :--- | :--- | :--- | :--- | :--- |
| **PASS** | Creates customer `cust_...` with `status: ACTIVE`, `plan: ENTERPRISE`, `balance: 250.00` | `status == ACTIVE`, `plan == ENTERPRISE`, `balance > 0` | REST reader reads actual customer record from `:4000/customers/cust_...` | **`PASS`** |
| **FAIL** | Claims customer is `ACTIVE`, but actual customer state in business service has `status: SUSPENDED` | `status == ACTIVE` | REST reader reads actual customer state showing `"SUSPENDED"` | **`FAIL`** (Observed value `"SUSPENDED"` != `"ACTIVE"`) |
| **INCONCLUSIVE** | Claims customer created, but resource ID `cust_nonexistent_9999` does not exist | `status == ACTIVE` | REST reader encounters 404/Missing resource. Inconclusive reason code `INC_RESOURCE_NOT_FOUND` | **`INCONCLUSIVE`** (Evidence acquisition failure is never conflated with FAIL) |

---

## 5. Security & Verification Guarantees

1. **Deterministic Verification**: Verdicts are computed by `VerificationEngine.evaluate()` on the server. The Python agent, frontend, and API caller cannot supply or override verdicts.
2. **SSRF Guard**: `RestApiStateReader` validates URLs, checks loopback policies, enforces read timeouts, and bounds max response sizes (1MB).
3. **Tenant Isolation**: `POST /api/v1/verifications` binds to the authenticated caller's tenant (`demo-corp`). Callers cannot access or verify resources across tenant boundaries.
4. **Secret Redaction**: Credentials (`CUSTOMER_SERVICE_API_KEY`) are fetched server-side from `EnvironmentSecretProvider` and masked (`env://...`). Evidence inspection endpoints recursively redact sensitive keys.
5. **Durable Persistence**: All verifications persist to `FileTraceRepository` and append to the cryptographic `FileAuditEventRepository`.
6. **Web Console Visibility**: Results appear live in the AgentProof Web Console at `http://localhost:3000/app/verifications`, complete with condition diffs, evidence manifests, and trace inspectors.
