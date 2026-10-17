# ADR 0001: Selection of TypeScript and NitroStack for MCP Server

**Status:** Approved  
**Date:** 2026-10-17  
**Deciders:** Principal Architect, MCP Specialist  

---

## Context
AgentProof requires an MCP-native runtime to integrate seamlessly with AI agents, developer tooling, and IDE environments. The server must expose type-safe tools, provide structured schemas for LLM tool calling, and support both local development and enterprise deployment.

## Decision
We select **TypeScript** (v5.3+) running on **Node.js** (v22+) and the **NitroStack MCP Framework** (`@nitrostack/core` and `@nitrostack/cli`) as the primary development platform.

## Alternatives Considered
1. **Python with FastMCP / Official MCP Python SDK:**
   - *Pros:* Popular in AI/ML research communities.
   - *Cons:* Weaker compile-time type guarantees across nested verification structures; lacks built-in NestJS-style dependency injection and companion widget architecture provided by NitroStack.
2. **Go with Official Go MCP SDK:**
   - *Pros:* Single binary distribution, high concurrent throughput.
   - *Cons:* Slower iteration speed for JSON-heavy dynamic schema evaluation; smaller ecosystem for agent frontends and interactive widgets.
3. **Vanilla Node.js with raw `@modelcontextprotocol/sdk`:**
   - *Pros:* Minimalist abstraction.
   - *Cons:* Requires re-inventing dependency injection, controllers, middleware pipelines, caching decorators, health monitoring, and transport negotiation which NitroStack already provides out of the box.

## Consequences
- **Positive:**
  - Rich decorator-driven architecture (`@Tool`, `@Module`, `@UseGuards`, `@UseFilters`).
  - Native dual-transport support (STDIO for local IDEs and HTTP SSE for remote clients).
  - Out-of-the-box support for interactive React UI widgets via `@nitrostack/widgets`.
  - Type-safe runtime validation powered by Zod.
- **Negative:**
  - Requires managing Node.js ES module intricacies (`"type": "module"` and `.js` import specifiers).
  - Dependency on the `@nitrostack/core` release lifecycle.

## Revisit Conditions
This decision may be revisited if client environments mandate a compiled, zero-runtime single executable (e.g., Go/Rust) or if Python becomes an unyielding requirement for custom ML tensor operations.
