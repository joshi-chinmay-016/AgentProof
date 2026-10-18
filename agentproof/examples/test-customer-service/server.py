#!/usr/bin/env python3
"""
AgentProof — Local Test Customer Business Service
Independent REST API representing an external system-of-record.

Endpoints:
  POST   /customers           Create customer record
  GET    /customers/{id}      Retrieve customer record (or 404)
  PUT    /customers/{id}      Update customer record (or 404)
  DELETE /customers/{id}      Delete customer record (or 404)
  GET    /health              Health probe endpoint

Authentication:
  Header: x-api-key: <CUSTOMER_SERVICE_API_KEY> (default: test-customer-key)
"""

import http.server
import json
import os
import sys
import urllib.parse
from datetime import datetime, timezone
import uuid

PORT = int(os.environ.get("PORT", os.environ.get("CUSTOMER_SERVICE_PORT", "4000")))
HOST = os.environ.get("HOST", "127.0.0.1")
EXPECTED_API_KEY = os.environ.get("CUSTOMER_SERVICE_API_KEY", "test-customer-key")

# In-memory customer repository
CUSTOMERS = {
    "cust-demo-100": {
        "id": "cust-demo-100",
        "name": "Acme Global Industries",
        "status": "ACTIVE",
        "plan": "enterprise",
        "balance": 5000,
        "createdAt": "2026-10-18T10:00:00Z",
        "updatedAt": "2026-10-18T10:00:00Z",
    }
}


class CustomerServiceHandler(http.server.BaseHTTPRequestHandler):
    server_version = "AgentProof-TestService/1.0"

    def log_message(self, format, *args):
        # Clean logging
        sys.stdout.write(f"[{datetime.now().strftime('%H:%M:%S')}] [CustomerService] {format % args}\n")
        sys.stdout.flush()

    def send_json(self, status_code, data):
        payload = json.dumps(data).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, x-api-key")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.end_headers()
        self.wfile.write(payload)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, x-api-key")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.end_headers()

    def check_auth(self):
        auth_header = self.headers.get("x-api-key") or self.headers.get("Authorization")
        if not auth_header:
            return False
        if auth_header.startswith("Bearer "):
            token = auth_header[7:].strip()
        else:
            token = auth_header.strip()
        return token == EXPECTED_API_KEY

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/health" or path == "/api/health":
            return self.send_json(200, {
                "status": "healthy",
                "service": "customer-service",
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "customerCount": len(CUSTOMERS),
            })

        # Protected endpoints
        if not self.check_auth():
            return self.send_json(401, {
                "error": "UNAUTHORIZED",
                "message": "Invalid or missing API key in 'x-api-key' or 'Authorization' header.",
            })

        if path == "/customers":
            return self.send_json(200, {
                "total": len(CUSTOMERS),
                "items": list(CUSTOMERS.values()),
            })

        if path.startswith("/customers/"):
            cust_id = path[len("/customers/"):]
            cust_id = urllib.parse.unquote(cust_id)
            if cust_id in CUSTOMERS:
                return self.send_json(200, CUSTOMERS[cust_id])
            else:
                return self.send_json(404, {
                    "error": "NOT_FOUND",
                    "message": f"Customer '{cust_id}' not found.",
                })

        return self.send_json(404, {"error": "ROUTE_NOT_FOUND", "path": path})

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if not self.check_auth():
            return self.send_json(401, {
                "error": "UNAUTHORIZED",
                "message": "Invalid or missing API key in 'x-api-key' or 'Authorization' header.",
            })

        if path == "/customers":
            content_length = int(self.headers.get("Content-Length", 0))
            raw_body = self.rfile.read(content_length)
            try:
                body = json.loads(raw_body.decode("utf-8")) if raw_body else {}
            except Exception:
                return self.send_json(400, {"error": "MALFORMED_JSON", "message": "Invalid JSON body"})

            now = datetime.now(timezone.utc).isoformat()
            cust_id = body.get("id") or f"cust-{uuid.uuid4().hex[:8]}"

            customer = {
                "id": cust_id,
                "name": body.get("name", "Unnamed Customer"),
                "status": body.get("status", "ACTIVE"),
                "plan": body.get("plan", "starter"),
                "balance": body.get("balance", 0),
                "createdAt": now,
                "updatedAt": now,
            }
            CUSTOMERS[cust_id] = customer
            return self.send_json(201, {"status": "created", "customer": customer})

        return self.send_json(404, {"error": "ROUTE_NOT_FOUND", "path": path})

    def do_PUT(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if not self.check_auth():
            return self.send_json(401, {
                "error": "UNAUTHORIZED",
                "message": "Invalid or missing API key.",
            })

        if path.startswith("/customers/"):
            cust_id = urllib.parse.unquote(path[len("/customers/"):])
            if cust_id not in CUSTOMERS:
                return self.send_json(404, {"error": "NOT_FOUND", "message": f"Customer '{cust_id}' not found."})

            content_length = int(self.headers.get("Content-Length", 0))
            raw_body = self.rfile.read(content_length)
            try:
                body = json.loads(raw_body.decode("utf-8")) if raw_body else {}
            except Exception:
                return self.send_json(400, {"error": "MALFORMED_JSON", "message": "Invalid JSON body"})

            existing = CUSTOMERS[cust_id]
            for key, val in body.items():
                if key != "id" and key != "createdAt":
                    existing[key] = val
            existing["updatedAt"] = datetime.now(timezone.utc).isoformat()
            return self.send_json(200, {"status": "updated", "customer": existing})

        return self.send_json(404, {"error": "ROUTE_NOT_FOUND", "path": path})

    def do_DELETE(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if not self.check_auth():
            return self.send_json(401, {"error": "UNAUTHORIZED", "message": "Invalid or missing API key."})

        if path.startswith("/customers/"):
            cust_id = urllib.parse.unquote(path[len("/customers/"):])
            if cust_id in CUSTOMERS:
                del CUSTOMERS[cust_id]
                self.send_response(204)
                self.end_headers()
                return
            return self.send_json(404, {"error": "NOT_FOUND", "message": f"Customer '{cust_id}' not found."})

        return self.send_json(404, {"error": "ROUTE_NOT_FOUND", "path": path})


def run():
    server = http.server.ThreadingHTTPServer((HOST, PORT), CustomerServiceHandler)
    print(f"[CustomerService] Listening on http://{HOST}:{PORT}")
    print(f"[CustomerService] API Key requirement: x-api-key: {EXPECTED_API_KEY}")
    print("[CustomerService] Endpoints:")
    print(f"  POST http://{HOST}:{PORT}/customers")
    print(f"  GET  http://{HOST}:{PORT}/customers/<id>")
    print(f"  PUT  http://{HOST}:{PORT}/customers/<id>")
    print(f"  GET  http://{HOST}:{PORT}/health")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[CustomerService] Shutting down...")
        server.server_close()


if __name__ == "__main__":
    run()
