# PostgreSQL Database Integration

## 1. Overview

`PostgresStateReader` observes database row state directly from relational tables. It is designed to verify postconditions such as record insertion, status updates, column mutations, and record deletion.

---

## 2. Security Architecture

1. **Dedicated Read-Only Role:** The reader must connect using a dedicated PostgreSQL role granted only `SELECT` privileges on specific permitted tables.
2. **Strictly Parameterized Queries:** All lookup values (e.g. `$1`) are passed as driver parameters. Untrusted inputs are NEVER concatenated into SQL strings.
3. **Allowlist Configuration:**
   - Schemas: restricted to `allowedSchemas` (defaults to `['public']`).
   - Tables: checked against `allowedTables`. Rejects unauthorized tables.
   - Columns: restricted to pre-configured `allowedColumns`.
   - Identifiers: validated against strict identifier regex `/^[a-zA-Z_][a-zA-Z0-9_]*$/`.
4. **No Raw SQL from MCP:** The MCP interface never accepts arbitrary SQL statements from AI agents.
5. **No Mutation Verbs:** Rejects write queries, DDL, schema alterations, and multi-statement queries.

---

## 3. Query Construction Strategy

Queries follow a deterministic, minimal query pattern:
```sql
SELECT "col1", "col2", "status" 
FROM "public"."subscriptions" 
WHERE "id" = $1 
LIMIT 1;
```
- Quoting: All schema, table, and column identifiers are double-quoted.
- Parameter: Target resource ID is passed as parameterized `$1`.
- Bound: `LIMIT 1` prevents cardinality exhaustion.
- Timeout: Enforced statement timeout (default 5000ms).

---

## 4. Observation Semantics

- **`FOUND`:** Authorized query returns exactly 1 row. Payload contains the selected columns.
- **`NOT_FOUND`:** Authorized query executes successfully and returns 0 rows. Confirms absence.
- **`READ_ERROR`:** Query statement timeout, permission denied (`42501`), connection failure, or query syntax failure. **Query failures never convert to NOT_FOUND.**

---

## 5. Driver Abstraction & Testing

The reader uses the `IPostgresDriver` abstraction:
```typescript
export interface IPostgresDriver {
  query(sql: string, params: unknown[], timeoutMs: number): Promise<PostgresQueryResult>;
}
```
In automated testing, `MockPostgresDriver` provides deterministic in-memory evaluations. In production, standard PostgreSQL drivers (e.g. `pg` Pool or Client) implement `IPostgresDriver`.
