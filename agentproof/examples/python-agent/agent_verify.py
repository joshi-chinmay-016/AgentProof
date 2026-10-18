#!/usr/bin/env python3
"""
AgentProof — Python AI Agent Verification Client
Demonstrates real end-to-end integration:
1. Python agent creates a real customer on the external REST Customer Service.
2. Python agent submits a verification request to AgentProof's authenticated API.
3. AgentProof independently queries the Customer Service via registered REST reader.
4. AgentProof deterministically evaluates explicit postconditions.
5. Authoritative verdict (PASS / FAIL / INCONCLUSIVE) is returned and persisted.
6. Web console displays the real verification run.

Usage:
  python agent_verify.py                  # Standard PASS verification run
  python agent_verify.py --scenario fail  # Deliberate FAIL verification run
  python agent_verify.py --scenario inc   # Deliberate INCONCLUSIVE run
  python agent_verify.py --all            # Run all three scenarios sequentially
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid

# --- Configuration (Read from environment with safe defaults) ---
AGENTPROOF_URL = os.environ.get("AGENTPROOF_URL", "http://localhost:3000").rstrip("/")
AGENTPROOF_API_KEY = os.environ.get("AGENTPROOF_API_KEY", "agentproof-dev-key")
CUSTOMER_SERVICE_URL = os.environ.get("CUSTOMER_SERVICE_URL", "http://localhost:4000").rstrip("/")
CUSTOMER_SERVICE_API_KEY = os.environ.get("CUSTOMER_SERVICE_API_KEY", "test-customer-key")
REQUEST_TIMEOUT_SEC = 10.0


def mask_secret(secret: str) -> str:
    """Mask secret values for safe diagnostics."""
    if not secret:
        return "[NOT SET]"
    if len(secret) <= 6:
        return "***"
    return secret[:3] + "..." + secret[-3:]


def http_request(method: str, url: str, headers: dict = None, data: dict = None) -> tuple[int, dict]:
    """Execute an HTTP request with bounded timeout, returning (status_code, json_body)."""
    headers = headers or {}
    encoded_data = None
    if data is not None:
        encoded_data = json.dumps(data).encode("utf-8")
        headers["Content-Type"] = "application/json"

    req = urllib.request.Request(url, data=encoded_data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT_SEC) as resp:
            status_code = resp.status
            body_bytes = resp.read()
            body_json = json.loads(body_bytes.decode("utf-8")) if body_bytes else {}
            return status_code, body_json
    except urllib.error.HTTPError as e:
        status_code = e.code
        body_bytes = e.read()
        try:
            body_json = json.loads(body_bytes.decode("utf-8")) if body_bytes else {}
        except Exception:
            body_json = {"raw_error": body_bytes.decode("utf-8", errors="replace")}
        return status_code, body_json
    except urllib.error.URLError as e:
        raise RuntimeError(f"Connection failure to {url}: {e.reason}") from e


def create_customer(name: str, plan: str = "enterprise", status: str = "ACTIVE", balance: int = 5000) -> str:
    """Step 1: Python Agent creates a real resource on the Customer Service REST API."""
    print(f"[*] [Agent Action] Creating customer '{name}' on Business API: {CUSTOMER_SERVICE_URL}/customers...")
    url = f"{CUSTOMER_SERVICE_URL}/customers"
    headers = {"x-api-key": CUSTOMER_SERVICE_API_KEY}
    payload = {
        "id": f"cust-{uuid.uuid4().hex[:8]}",
        "name": name,
        "plan": plan,
        "status": status,
        "balance": balance,
    }

    code, resp = http_request("POST", url, headers, payload)
    if code not in (200, 201):
        raise RuntimeError(f"Failed to create customer record on Business Service (HTTP {code}): {resp}")

    customer = resp.get("customer", {})
    cust_id = customer.get("id") or payload["id"]
    print(f"[+] [Agent Action] Customer created successfully with ID: {cust_id} (status={status}, plan={plan})")
    return cust_id


def mutate_customer(customer_id: str, new_status: str) -> None:
    """Mutate customer state to set up a test condition (e.g. state violation)."""
    print(f"[*] [Mutate State] Setting customer '{customer_id}' status to '{new_status}'...")
    url = f"{CUSTOMER_SERVICE_URL}/customers/{customer_id}"
    headers = {"x-api-key": CUSTOMER_SERVICE_API_KEY}
    code, resp = http_request("PUT", url, headers, {"status": new_status})
    if code != 200:
        raise RuntimeError(f"Failed to update customer status (HTTP {code}): {resp}")
    print(f"[+] [Mutate State] Customer '{customer_id}' updated to '{new_status}'")


def verify_outcome(
    customer_id: str,
    operation_name: str,
    required_status: str = "ACTIVE",
    required_plan: str = "enterprise",
    integration_id: str = "customer-service-rest"
) -> dict:
    """
    Step 2: Submit verification request to AgentProof's authenticated verification API.
    AgentProof independently retrieves external REST state and evaluates postconditions.
    """
    url = f"{AGENTPROOF_URL}/api/v1/verifications"
    headers = {
        "Authorization": f"Bearer {AGENTPROOF_API_KEY}",
        "x-agentproof-tenant": "default-tenant",
    }

    # Declarative postconditions asserting required ground truth in system-of-record
    postconditions = [
        {
            "id": "customer_account_status",
            "description": f"Customer record must exist with status '{required_status}'",
            "path": "status",
            "operator": "EQUALS",
            "expectedValue": required_status,
            "enforcement": "REQUIRED",
        },
        {
            "id": "customer_plan_tier",
            "description": f"Customer plan tier must be '{required_plan}'",
            "path": "plan",
            "operator": "EQUALS",
            "expectedValue": required_plan,
            "enforcement": "REQUIRED",
        },
        {
            "id": "customer_positive_balance",
            "description": "Customer account balance must be strictly positive",
            "path": "balance",
            "operator": "GREATER_THAN",
            "expectedValue": 0,
            "enforcement": "REQUIRED",
        },
    ]

    verification_request = {
        "operation": operation_name,
        "integrationId": integration_id,
        "target": {
            "system": "customer_service",
            "resourceType": "customer",
            "resourceId": customer_id,
        },
        "intent": {
            "operation": operation_name,
            "summary": f"Verify creation and initialization of customer {customer_id}",
            "expectedChanges": {
                "status": required_status,
                "plan": required_plan,
            },
        },
        "action": {
            "toolName": "create_customer_api",
            "executionStatus": "REPORTED_SUCCESS",
            "agentId": "python-agent-v1",
            "invokedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - 2)),
            "completedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        },
        "postconditions": postconditions,
        "policy": {
            "timeoutMs": 4000,
            "requireIndependentSource": True,
            "freshnessToleranceMs": 60000,
        },
    }

    print(f"[*] [AgentProof Verification] Submitting verification request to: {url}...")
    code, resp = http_request("POST", url, headers, verification_request)

    if code == 401:
        raise PermissionError(f"AgentProof authentication failed (HTTP 401): {resp}")
    if code == 403:
        raise PermissionError(f"AgentProof authorization / tenant error (HTTP 403): {resp}")
    if code != 201:
        raise RuntimeError(f"AgentProof verification submission failed (HTTP {code}): {resp}")

    return resp


def inspect_verification(trace_id: str) -> dict:
    """Step 3: Retrieve full persisted result and audit references from AgentProof."""
    url = f"{AGENTPROOF_URL}/api/v1/verifications/{trace_id}"
    headers = {
        "Authorization": f"Bearer {AGENTPROOF_API_KEY}",
        "x-agentproof-tenant": "default-tenant",
    }
    code, resp = http_request("GET", url, headers)
    if code != 200:
        raise RuntimeError(f"Failed to inspect verification trace '{trace_id}' (HTTP {code}): {resp}")
    return resp


def inspect_evidence(trace_id: str) -> dict:
    """Step 4: Retrieve independent evidence observations with provenance and redacted payloads."""
    url = f"{AGENTPROOF_URL}/api/v1/verifications/{trace_id}/evidence"
    headers = {
        "Authorization": f"Bearer {AGENTPROOF_API_KEY}",
        "x-agentproof-tenant": "default-tenant",
    }
    code, resp = http_request("GET", url, headers)
    if code != 200:
        raise RuntimeError(f"Failed to retrieve evidence for trace '{trace_id}' (HTTP {code}): {resp}")
    return resp


def run_scenario(scenario_type: str) -> str:
    """Run a specific verification scenario and return the authoritative verdict."""
    print("=" * 72)
    print(f"AGENTPROOF REAL INTEGRATION DEMO — SCENARIO: {scenario_type.upper()}")
    print("=" * 72)
    print(f"AgentProof Endpoint : {AGENTPROOF_URL}")
    print(f"AgentProof Token    : {mask_secret(AGENTPROOF_API_KEY)}")
    print(f"Customer Service    : {CUSTOMER_SERVICE_URL}")
    print(f"Business API Key    : {mask_secret(CUSTOMER_SERVICE_API_KEY)}")
    print("-" * 72)

    if scenario_type == "pass":
        # 1. Real PASS: customer created with ACTIVE, postconditions assert ACTIVE
        cust_id = create_customer("Acme AI Corp", plan="enterprise", status="ACTIVE", balance=7500)
        result = verify_outcome(cust_id, "provision_active_customer", required_status="ACTIVE", required_plan="enterprise")

    elif scenario_type == "fail":
        # 2. Real FAIL: customer created with SUSPENDED state, postcondition requires ACTIVE
        # Agent claims success, but independent observation reveals violation
        cust_id = create_customer("Beta Logistics", plan="enterprise", status="SUSPENDED", balance=2500)
        print("[!] [Agent Claim] Agent reports 'create_customer: SUCCESS (status=ACTIVE)'")
        print("[*] [AgentProof] Evaluating postconditions against independent REST observation...")
        result = verify_outcome(cust_id, "provision_active_customer", required_status="ACTIVE", required_plan="enterprise")

    elif scenario_type == "inconclusive":
        # 3. Real INCONCLUSIVE: querying a non-existent or unreachable resource
        non_existent_id = f"cust-ghost-{uuid.uuid4().hex[:6]}"
        print(f"[*] [Inconclusive Demo] Target customer ID: {non_existent_id} (Does not exist in Customer Service)")
        result = verify_outcome(non_existent_id, "verify_missing_resource", required_status="ACTIVE", required_plan="enterprise")

    else:
        raise ValueError(f"Unknown scenario '{scenario_type}'")

    trace_id = result.get("traceId")
    verdict = result.get("verdict") or result.get("overallVerdict")
    summary = result.get("summary")
    duration = result.get("executionDurationMs", 0)

    print("\n" + "=" * 72)
    print("AGENTPROOF AUTHORITATIVE VERDICT:")
    print("=" * 72)
    print(f"Verification Trace ID : {trace_id}")
    print(f"Authoritative Verdict : [{verdict}]")
    print(f"Deterministic Summary : {summary}")
    print(f"Engine Execution Time : {duration:.2f} ms")
    print("-" * 72)
    print("Condition Evaluations:")
    for cond in result.get("conditionEvaluations", []):
        v = cond.get("verdict")
        cid = cond.get("conditionId")
        exp = cond.get("expected")
        obs = cond.get("observed")
        explanation = cond.get("explanation")
        print(f"  • [{v:<12}] {cid}: expected={exp}, observed={obs}")
        if v != "PASS":
            print(f"      Reason: {explanation}")

    # Inspect persisted trace and evidence from AgentProof
    if trace_id:
        print("\n[*] Inspecting persisted evidence provenance from AgentProof...")
        ev_resp = inspect_evidence(trace_id)
        evidence_items = ev_resp.get("evidence", [])
        print(f"[+] Total Evidence Items Acquired: {len(evidence_items)}")
        for i, ev in enumerate(evidence_items, start=1):
            source = ev.get("sourceId")
            kind = ev.get("sourceKind")
            trust = ev.get("trustLevel")
            obs_status = ev.get("observationStatus")
            ihash = ev.get("integrityHash", "")[:16] + "..."
            print(f"    [{i}] Source: {source} ({kind}) | Status: {obs_status} | Trust: {trust} | SHA-256: {ihash}")

    print("\n" + "=" * 72)
    print(f"Result available in Web Console: {AGENTPROOF_URL}/app#verifications")
    print("=" * 72 + "\n")
    return verdict


def main():
    parser = argparse.ArgumentParser(description="AgentProof Real Python Agent Integration")
    parser.add_argument(
        "--scenario",
        choices=["pass", "fail", "inc", "inconclusive"],
        default="pass",
        help="Scenario to execute (pass = condition met, fail = state violated, inc = read error/absent)",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Run all three scenarios (PASS, FAIL, INCONCLUSIVE) sequentially",
    )
    args = parser.parse_args()

    scen = "inconclusive" if args.scenario in ("inc", "inconclusive") else args.scenario

    if args.all:
        verdicts = {}
        for s in ["pass", "fail", "inconclusive"]:
            verdicts[s] = run_scenario(s)
            time.sleep(1)

        print("SUMMARY OF ALL SCENARIOS:")
        print(f"  PASS Scenario        => Verdict: {verdicts['pass']}")
        print(f"  FAIL Scenario        => Verdict: {verdicts['fail']}")
        print(f"  INCONCLUSIVE Scenario=> Verdict: {verdicts['inconclusive']}")

        all_ok = (
            verdicts["pass"] == "PASS"
            and verdicts["fail"] == "FAIL"
            and verdicts["inconclusive"] == "INCONCLUSIVE"
        )
        sys.exit(0 if all_ok else 1)

    verdict = run_scenario(scen)
    if verdict == "PASS":
        sys.exit(0)
    elif verdict == "FAIL":
        sys.exit(2)
    elif verdict == "INCONCLUSIVE":
        sys.exit(3)
    else:
        sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"\n[!] Execution Error: {e}", file=sys.stderr)
        sys.exit(1)
