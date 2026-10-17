# AgentProof — Phase 0: Repository Discovery

**Document Version:** 1.0.0  
**Status:** Approved Specification  
**Author:** Software Architect & Reliability Engineering Lead  
**Scope:** Workspace Analysis, Starter Template Conventions, Environment Inventory  

---

## 1. Executive Summary

This document presents a factual inventory of the repository and application environment for **AgentProof**. The workspace was inspected directly to establish physical paths, directory layouts, runtime conventions, dependency graphs, framework lifecycles, and existing development scripts.

No architectural assumptions or invented framework APIs are used. All NitroStack conventions documented herein reflect the actual `@nitrostack/core` and `@nitrostack/cli` template installed in the workspace.

---

## 2. Repository & Application Identity

### 2.1 Dual-Root Topology
The workspace exhibits a nested repository structure resulting from initializing a NitroStack starter template inside a Git repository clone:

| Identity | Path | Ownership & Purpose |
| :--- | :--- | :--- |
| **Git Repository Root** | `c:\agentproof` | Owns `.git/` metadata, Git branches, Git remotes, and root repository configuration. |
| **Application Root** | `c:\agentproof\agentproof` | Owns `package.json`, `tsconfig.json`, `src/`, `node_modules/`, `dist/`, and local application configuration. |

### 2.2 Git Configuration
- **Remote Origin:** `https://github.com/joshi-chinmay-016/agentproof.git`
- **Active Branch:** `main`
- **Git Metadata Location:** `c:\agentproof\.git`
- **Application Directory Git Status:** `c:\agentproof\agentproof` does not contain a separate `.git` folder. It is tracked as part of the parent repository.

> [!IMPORTANT]
> **Directory Ownership Rule:**
> All application commands (`npm run dev`, `npm run build`, etc.) must be executed within `c:\agentproof\agentproof`.
> All Git operations (commits, tags, pushes) operate relative to `c:\agentproof`.
> The application code must **not** be moved or relocated to avoid breaking local project bindings or CI/CD pipelines.

---

## 3. Directory Structure & File Inventory

The physical layout of the application root (`c:\agentproof\agentproof`) is structured as follows:

```
c:\agentproof\agentproof/
├── .agents/                        # Agent customization instructions
├── .antigravity/                   # Framework skills & documentation
│   └── skills/
│       ├── auth-security/          # NitroStack Auth, JWT, ApiKey, RBAC guide
│       ├── mcp-app-architecture/   # NitroStack Modules, DI, Lifecycles, Events
│       ├── middleware-pipeline/    # NitroStack Guards, Interceptors, Pipes, Filters
│       ├── tools-resources-prompts/# NitroStack @Tool, @Resource, @Prompt, @Cache
│       └── ui-widgets/             # NitroStack @Widget, useWidgetSDK guide
├── .claude/                        # Editor assistant workspace metadata
├── .codex/                         # Editor assistant workspace metadata
├── .copilot/                       # Editor assistant workspace metadata
├── .cursor/                        # Editor assistant workspace metadata
├── .env.example                    # Template environment variables
├── .gemini/                        # Editor assistant workspace metadata
├── .gitignore                      # Application ignore rules
├── .opencode/                      # Editor assistant workspace metadata
├── README.md                       # Starter template README
├── dist/                           # Compiled server outputs (ES2022 JS + d.ts)
├── node_modules/                   # Installed runtime & dev dependencies
├── package.json                    # Root manifest and npm scripts
├── package-lock.json               # Deterministic dependency lockfile
├── src/
│   ├── index.ts                    # Server bootstrap entry point
│   ├── app.module.ts               # Root @McpApp and @Module definition
│   ├── health/
│   │   └── system.health.ts        # @HealthCheck implementation
│   ├── modules/
│   │   └── calculator/             # Starter demonstration module
│   │       ├── calculator.module.ts
│   │       ├── calculator.prompts.ts
│   │       ├── calculator.resources.ts
│   │       └── calculator.tools.ts
│   └── widgets/                    # Next.js 14 companion widget application
│       ├── .next/                  # Next.js build cache
│       ├── app/                    # Next.js app router components
│       ├── next.config.js          # Next.js configuration
│       ├── node_modules/           # Widget-specific dependencies
│       ├── out/                    # Static export output
│       ├── package.json            # Widget manifest
│       ├── tsconfig.json           # Widget TypeScript configuration
│       └── widget-manifest.json    # MCP UI widget registry manifest
└── tsconfig.json                   # Root TypeScript compiler options
```

---

## 4. Source Code Factual Inventory

### 4.1 Entry Point (`src/index.ts`)
- **Responsibility:** Bootstraps the NitroStack MCP application instance.
- **Mechanism:**
  ```typescript
  import 'dotenv/config';
  import { McpApplicationFactory } from '@nitrostack/core';
  import { AppModule } from './app.module.js';

  async function bootstrap() {
    const server = await McpApplicationFactory.create(AppModule);
    await server.start();
  }
  bootstrap().catch((error) => {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  });
  ```
- **Conventions:** Imports use `.js` extension required by Node ES Modules.

### 4.2 Root Module (`src/app.module.ts`)
- **Responsibility:** Top-level application container registering submodules and providers.
- **Decorators:**
  - `@McpApp`: Configures server metadata (`name: 'agentproof'`, `version: '1.0.0'`) and global logging.
  - `@Module`: Declares module dependencies via `imports: [ConfigModule.forRoot(), CalculatorModule]` and `providers: [SystemHealthCheck]`.

### 4.3 Health Check (`src/health/system.health.ts`)
- **Responsibility:** System resource and uptime monitoring.
- **Decorator:** `@HealthCheck({ name: 'system', description: '...', interval: 30 })`.
- **Interface:** Implements `HealthCheckInterface` returning `Promise<HealthCheckResult>` with memory, uptime, PID, and Node version metrics.

### 4.4 Starter Module (`src/modules/calculator/*`)
- **Responsibility:** Illustrative template implementation of MCP primitives.
- **Files:**
  - `calculator.module.ts`: Declares `@Module({ name: 'calculator', controllers: [...] })`.
  - `calculator.tools.ts`: Exposes `@Tool` handlers (`calculate`, `convert_temperature`) with Zod input validation schemas and `@Widget('calculator-result')` linkage.
  - `calculator.resources.ts`: Exposes `@Resource({ uri: 'calculator://operations', ... })`.
  - `calculator.prompts.ts`: Exposes `@Prompt({ name: 'calculator_help', ... })`.

### 4.5 Widgets Subsystem (`src/widgets/*`)
- **Responsibility:** Embedded Next.js 14 web client supporting interactive MCP UI widgets.
- **Tooling:** Uses `@nitrostack/widgets` and `@modelcontextprotocol/ext-apps`.
- **Server:** Runs a Next.js development server on port `3001` (`npm --prefix src/widgets dev`).

---

## 5. Dependency & Configuration Analysis

### 5.1 Root Dependencies (`package.json`)
```json
{
  "dependencies": {
    "dotenv": "^16.3.1",
    "@nitrostack/core": "^1",
    "zod": "^3.25.0",
    "@modelcontextprotocol/ext-apps": "^1.0.0"
  },
  "devDependencies": {
    "@nitrostack/cli": "^1",
    "@types/node": "^22.10.0",
    "typescript": "^5.3.3"
  }
}
```

### 5.2 TypeScript Configuration (`tsconfig.json`)
- **Target:** `ES2022`
- **Module:** `ES2022`
- **Module Resolution:** `node`
- **Strict Mode:** `true` (`strict: true`)
- **Decorators:** `experimentalDecorators: true`, `emitDecoratorMetadata: true`
- **Source Paths:** `rootDir: "./src"`, `outDir: "./dist"`
- **Exclusions:** `node_modules`, `dist`, `src/widgets` (widgets maintain their own `tsconfig.json`).

### 5.3 Scripts Inventory
| Script | Command | Purpose |
| :--- | :--- | :--- |
| `dev` | `nitrostack-cli dev` | Compiles server, starts watch mode, starts widget dev server on `:3001`. |
| `build` | `nitrostack-cli build` | Builds production artifacts for both core server and widgets. |
| `start` | `npm run build && nitrostack-cli start` | Compiles and executes production server. |
| `start:prod` | `nitrostack-cli start` | Executes existing build artifacts without rebuilding. |
| `upgrade` | `nitrostack-cli upgrade` | Upgrades NitroStack dependencies. |
| `install:all` | `nitrostack-cli install` | Installs dependencies across root and widget subproject. |
| `widget` | `npm --prefix src/widgets` | Proxies npm commands into the Next.js widget directory. |

---

## 6. NitroStack Framework Conventions

From direct inspection of `.antigravity/skills` and template code, the exact NitroStack conventions are:

1. **Architecture Style:** NestJS-inspired modular architecture with inversion of control and dependency injection.
2. **Tool Registration:**
   - Decorated with `@Tool({ name, description, inputSchema, outputSchema, examples })`.
   - Tool methods receive `(input: T, ctx: ExecutionContext)`.
   - Schemas are defined using `zod` (`import { z } from '@nitrostack/core'`).
   - Logging is accessed via `ctx.logger.info(...)`, `ctx.logger.error(...)`.
3. **Pipeline Decorators:**
   - `@UseGuards(GuardClass)`: Enforces precondition checks or authorization.
   - `@UseInterceptors(InterceptorClass)`: Intercepts request/response and measures execution timing.
   - `@UsePipes(PipeClass)`: Transforms or sanitizes inputs.
   - `@UseFilters(FilterClass)`: Traps and standardizes runtime exceptions.
   - `@Cache({ ttl, key })`: Transparent result caching.
   - `@RateLimit({ requests, window, key })`: Rate limiting per tool.
4. **Lifecycle Hooks:**
   - Providers can implement `OnModuleInit`, `OnApplicationBootstrap`, `OnModuleDestroy`, `BeforeApplicationShutdown`, and `OnApplicationShutdown`.
5. **Decoupled Eventing:**
   - `emitEvent(eventName, payload)` and `@OnEvent(eventName)` facilitate decoupled asynchronous event propagation.

---

## 7. Transport & Environment Configuration

Inspecting `.env.example` reveals the runtime transport options supported:

| Environment Variable | Default Value | Allowed Values | Description |
| :--- | :--- | :--- | :--- |
| `NITRO_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` | Console logger verbosity. |
| `NITROSTACK_APP_MODE` | `universal` | `universal`, `server`, `client` | Application operational mode. |
| `MCP_TRANSPORT_TYPE` | `stdio` (dev), `dual` (prod) | `stdio`, `http`, `dual` | MCP protocol transport. `stdio` is standard for CLI/IDE clients; `dual` provides both stdio and HTTP SSE. |
| `PORT` | `3000` | Port number | HTTP server listener port (when http/dual enabled). |
| `HOST` | `localhost` | Host string | HTTP bind interface. |
| `ENABLE_CORS` | `true` | `true`, `false` | Cross-origin resource sharing toggle. |
| `NITRO_MCP_PROTOCOL_VERSION` | `auto` | `auto`, `2026-07-28`, `2025-06-18` | Selects MCP wire revision. `auto` serves both modern stateless and legacy sessionful clients. |

---

## 8. Gap Analysis & Constraints for Phase 1

1. **Missing Automated Test Framework:**
   - **Fact:** The starter template does not include Vitest, Jest, or any test runner. There is no `npm test` script.
   - **Phase 1 Resolution:** Introduce `vitest` into `devDependencies` along with a configured `vitest.config.ts` and `npm test` script.
2. **Template Separation:**
   - **Fact:** The repository contains the calculator template module.
   - **Phase 1 Resolution:** Preserve the calculator module initially to avoid breaking existing CLI build validations, while introducing an isolated, domain-pure `src/core` and `src/modules/verification` module.
3. **TypeScript Module Resolution:**
   - **Fact:** ES Modules with `moduleResolution: node` and `target: ES2022` require explicit `.js` extensions on relative file imports (e.g., `import { Foo } from './foo.js'`).
   - **Phase 1 Resolution:** All newly authored TypeScript files must strictly adhere to this ES module import standard.
4. **Decorators & Nesting:**
   - **Fact:** Experimental decorators are required for NitroStack controllers and providers.
   - **Phase 1 Resolution:** The core domain logic must remain pure TypeScript functions and plain classes, free of decorator metadata, so that the verification engine can execute independently in tests without a running NitroStack container.
