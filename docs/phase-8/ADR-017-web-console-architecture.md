# ADR-017: Web Console Standalone HTTP Server & SPA Architecture

## Status
Accepted

## Context
AgentProof provides deterministic postcondition verification for AI agents. In Phases 0 through 7, AgentProof operated primarily over an MCP STDIO transport, with an HTTP webhook ingestion receiver added in Phase 7.
For Phase 8, AgentProof requires a developer-facing web console to allow engineers to monitor verification runs, inspect evidence provenance, verify audit chain integrity, and manage integrations.

The architecture had to resolve whether to:
1. Couple the web console into the MCP STDIO process, or
2. Build an external microservice, or
3. Implement a lightweight, standalone `ConsoleServer` within the core repository that coordinates static SPA delivery, dedicated REST API dispatch, and webhook ingestion without polluting MCP STDIO.

## Decision
We implemented a dedicated `ConsoleServer` and `ConsoleApiHandler` in `src/server/`:
- `ConsoleServer` is a pure Node.js HTTP server that binds to port 3000 (configurable via `CONSOLE_PORT`).
- It routes `/api/*` to `ConsoleApiHandler`.
- It routes `/api/v1/webhooks/*` and `/webhooks/*` to `WebhookReceiver`.
- It serves static assets from `public/` and handles SPA routing fallback to `index.html`.
- The MCP server in `src/index.ts` remains completely isolated, preserving STDIO transport integrity and preventing stdout pollution.

## Consequences
- **Positive**: Zero impact on existing MCP tools or STDIO JSON-RPC framing.
- **Positive**: The web console can be deployed standalone, run locally for developers, or run behind enterprise reverse proxies.
- **Positive**: Single codebase, sharing domain models, repositories, and verification engines directly without network hops.
- **Negative**: Developers running both MCP STDIO and the Web Console locally start them as distinct processes or commands.
