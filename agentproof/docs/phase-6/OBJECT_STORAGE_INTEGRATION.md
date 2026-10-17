# S3-Compatible Object Storage Integration

## 1. Overview

`S3ObjectStateReader` provides read-only observation of cloud storage objects across S3-compatible object storage services (AWS S3, MinIO, Cloudflare R2, Ceph).

It verifies:
- Object existence.
- Object content length.
- ETag.
- Last-modified timestamp.
- Custom metadata headers (`x-amz-meta-*`).

---

## 2. Resource & Security Controls

1. **Lightweight `HEAD` Operations:** The reader uses HTTP `HEAD` operations to observe object existence and metadata headers without downloading multi-megabyte/gigabyte payloads.
2. **Bucket & Prefix Restrictions:**
   - Bucket: Fixed per integration configuration. Callers cannot enumerate or switch buckets.
   - Allowed Prefixes: Object keys must start with one of `allowedPrefixes` (e.g. `reports/`, `invoices/`).
3. **Path Traversal Prevention:** Object keys containing `..`, leading `/`, or backslashes are rejected as `SSRF_VIOLATION`.
4. **Credential Isolation:** S3 credentials (Bearer, API keys) are resolved server-side through `ISecretProvider`. They are never passed via MCP tool parameters or returned in responses.

---

## 3. Cryptographic Honesty: ETag vs SHA-256

AgentProof strictly distinguishes between S3 entity tags (`ETag`) and content cryptographic hashes:
- In AWS S3, an ETag is an MD5 hash only for single-part PUT uploads. For multipart uploads or KMS-encrypted objects, the ETag contains multipart part count suffixes or internal identifiers.
- An ETag does NOT prove a SHA-256 content digest.
- Every S3 observation record includes an explicit limitation:
  `'ETag is an S3-specific identifier and does not prove SHA-256 payload integrity.'`
- Verified content integrity postconditions require explicit cryptographic digests, not superficial ETag equality.

---

## 4. Status Mapping

- **`200 OK`:** `FOUND`. Payload includes `exists: true`, `etag`, `contentLength`, `lastModified`, and custom metadata.
- **`404 Not Found`:** `NOT_FOUND`. Confirms object absence.
- **`401 / 403`:** `READ_ERROR` with `AUTHORIZATION_FAILURE`.
- **`429 / 503 SlowDown`:** `READ_ERROR` with `RATE_LIMITED`.
- **`AbortError`:** `READ_ERROR` with `TIMEOUT`.
