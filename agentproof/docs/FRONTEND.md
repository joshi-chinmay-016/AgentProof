# AgentProof Web Console — Frontend Architecture & Design System (Phase 8)

> **Document Classification:** Frontend Engineering Specification & Component Kit Reference  
> **Repository:** `agentproof`  
> **Status:** Production Ready  
> **Version:** 1.0.0 (Phase 8 Console Release)

---

## 1. System Architecture

The AgentProof Web Console provides an institutional-grade, observable verification console designed to stand alongside developer tools such as Linear, Vercel, Stripe Dashboard, and Anthropic Console.

### 1.1 Architectural Invariants
- **Backend Verdict Authority:** The frontend *never* calculates, infers, or overrides verdicts. Authoritative outcomes (`PASS`, `FAIL`, `INCONCLUSIVE`) are returned by the deterministic verification engine.
- **Aggregation Precedence:** Strictly `FAIL > INCONCLUSIVE > PASS`.
- **Observation vs. Verdict Distinction:** Observation statuses (`FOUND`, `NOT_FOUND`, `READ_ERROR`, `UNTRUSTED`) represent evidence reading outcomes, not overall verification verdicts.
- **Simulation Visibility:** All simulated traces (`SCENARIO_A` through `SCENARIO_H`) are explicitly labeled with `[SIMULATION]`.
- **Zero Secret Exfiltration:** Database credentials, AWS secret keys, and webhook secrets never reach the browser; references are masked (e.g., `vault://...`, `env://...`) and scoped server-side.
- **MCP STDIO Preservation:** MCP STDIO transport operates independently and unpolluted. The Web Console is served via an isolated HTTP daemon on port 3000.

---

## 2. Design System & Tokens

### 2.1 Spacing & Layout Grid (4px Base Grid)
| Token | Value | Primary Usage |
| :--- | :--- | :--- |
| `--space-1` | `4px` | Fine padding, badge gaps |
| `--space-2` | `8px` | Icon-to-text gaps, input inner padding |
| `--space-3` | `12px` | Card internal padding, button gaps |
| `--space-4` | `16px` | Standard component margin, form item gaps |
| `--space-5` | `20px` | Card headers, section dividers |
| `--space-6` | `24px` | Page container padding, modal headers |
| `--space-8` | `32px` | Major section gaps, dashboard grid gaps |
| `--space-10` | `40px` | Hero spacing, empty-state container padding |

### 2.2 Semantic Color Tokens

#### Obsidian Dark Theme (Default)
```css
--bg-canvas: #090d16;
--bg-subtle: #0f1626;
--bg-surface: #141d30;
--bg-card: #19243c;
--bg-card-hover: #1f2d4a;
--border-subtle: rgba(255, 255, 255, 0.08);
--border-card: rgba(255, 255, 255, 0.11);
--text-primary: #f8fafc;
--text-secondary: #94a3b8;
--text-muted: #64748b;
--accent: #06b6d4;
```

#### Slate Light Theme
```css
--bg-canvas: #f8fafc;
--bg-subtle: #f1f5f9;
--bg-surface: #ffffff;
--bg-card: #ffffff;
--bg-card-hover: #f8fafc;
--border-subtle: rgba(0, 0, 0, 0.08);
--border-card: rgba(0, 0, 0, 0.12);
--text-primary: #0f172a;
--text-secondary: #475569;
--text-muted: #94a3b8;
--accent: #0284c7;
```

#### Verdict Semantic Tokens (Reserved Exclusively for Outcomes)
```css
--verdict-pass: #10b981;
--verdict-pass-subtle: rgba(16, 185, 129, 0.12);
--verdict-pass-border: rgba(16, 185, 129, 0.3);

--verdict-fail: #ef4444;
--verdict-fail-subtle: rgba(239, 68, 68, 0.12);
--verdict-fail-border: rgba(239, 68, 68, 0.3);

--verdict-inconclusive: #f59e0b;
--verdict-inconclusive-subtle: rgba(245, 158, 11, 0.12);
--verdict-inconclusive-border: rgba(245, 158, 11, 0.3);
```

#### Observation Status Tokens (Distinct from Verdicts)
```css
--obs-found: #38bdf8;
--obs-not-found: #94a3b8;
--obs-read-error: #f43f5e;
--obs-untrusted: #a855f7;
```

---

## 3. Documented Component Kit

### 3.1 Verdict Badge (`.verdict-badge`)
Renders an authoritative outcome with icon + label + color (never color alone, WCAG AA compliant).
- **PASS:** `<span class="verdict-badge pass">✓ PASS</span>`
- **FAIL:** `<span class="verdict-badge fail">✕ FAIL</span>`
- **INCONCLUSIVE:** `<span class="verdict-badge inconclusive">⚠ INCONCLUSIVE</span>`

### 3.2 Observation Status Badge (`.obs-badge`)
Used across evidence listings and postcondition evaluation diffs to represent read states:
- **FOUND:** `<span class="obs-badge found">● FOUND</span>`
- **NOT_FOUND:** `<span class="obs-badge not-found">○ NOT_FOUND</span>`
- **READ_ERROR:** `<span class="obs-badge read-error">⚠ READ_ERROR</span>`
- **UNTRUSTED:** `<span class="obs-badge untrusted">🛡 UNTRUSTED</span>`

### 3.3 Expected vs Observed Diff Box (`.diff-container`)
Split-pane diff viewer highlighting expected postcondition predicates against independently observed state. Displays matching states with emerald accent and failing states with crimson border.

### 3.4 Verdict Driver Callout Banner (`.verdict-driver-banner`)
Identifies the specific postcondition condition that determined the overall verdict:
- **FAIL:** Callout indicating violated predicate and expected vs. observed mismatch.
- **INCONCLUSIVE:** Callout explaining missing, stale, or untrusted evidence.
- **PASS:** Confirmation that all required postconditions were satisfied.

### 3.5 Persistent "Getting Started" Checklist (`.checklist-card`)
Tracks 5 core developer actions:
1. Run a verification simulation scenario.
2. Inspect a verification run detail drawer.
3. Inspect independent evidence & provenance.
4. Verify cryptographic audit chain integrity.
5. Check external state reader connectivity.
Progress is stored in `localStorage` and dismissible by the user.

### 3.6 "Since You Last Visited" Banner (`.since-banner`)
Connects to `GET /api/activity/since?since=<timestamp>` to compute real changes since the user's prior session: new verification runs evaluated, audit chain blocks appended, and webhook events processed.

### 3.7 Signature 3D Pipeline Visualization (`.three-scene-wrapper`)
Interactive WebGL 4-stage verification model:
1. **Claimed Action:** 3D cube mesh with cyan glow.
2. **Postconditions:** 3D octahedron mesh with blue accent.
3. **Independent Evidence:** 3D dodecahedron mesh with purple accent.
4. **Authoritative Verdict:** 3D sphere mesh glowing green (`PASS`), red (`FAIL`), or amber (`INCONCLUSIVE`).
Features:
- Traveling photon particle along Catmull-Rom spline connecting curve.
- Capped DPR (`1.5`) for performance efficiency.
- Automatically pauses when container is offscreen (`IntersectionObserver`) or when document is hidden.
- Includes a "Reduce Visuals" button providing a 100% functional 2D SVG fallback.
- Screen-reader text alternative (`.sr-only`).

### 3.8 Command Palette & Keyboard Shortcuts
- **`Ctrl+K` / `⌘+K`:** Quick search to jump to pages, execute scenarios, or run verifications.
- **`?` / `Shift+/`:** Keyboard shortcuts cheat sheet modal.
- **`Ctrl+B` / `⌘+B`:** Toggle sidebar collapse.
- **`1` – `6`:** Quick navigation across views (1: Overview, 2: Verifications, 3: Evidence, 4: Integrations, 5: Scenarios, 6: Help).
- **`T`:** Toggle Dark / Light theme.
- **`Esc`:** Close any active modal, drawer, or search window.

---

## 4. Browser API Contracts (Typed Schemas)

All endpoints validate inputs and outputs using strict Zod schemas and enforce tenant scoping via the `x-agentproof-tenant` header.

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/healthz` | Kubernetes liveness probe |
| `GET` | `/readyz` | Kubernetes readiness probe |
| `GET` | `/api/health` | Comprehensive subsystem health inspection |
| `GET` | `/api/overview` | KPI metrics, attention items, verdict distribution |
| `GET` | `/api/activity/since` | Real changes since specified timestamp |
| `GET` | `/api/verifications` | List verification traces with cursor pagination & filtering |
| `GET` | `/api/verifications/:id` | Full verification detail with postconditions & evidence |
| `POST` | `/api/verifications/run` | Execute independent verification against claimed action |
| `GET` | `/api/evidence` | List independent evidence records with trust levels |
| `GET` | `/api/timeline` | Chronological audit and verification event trail |
| `GET` | `/api/audit/integrity` | Cryptographic SHA-256 hash chain verification |
| `POST` | `/api/audit/verify` | Trigger full-chain digest recomputation |
| `POST` | `/api/audit/checkpoints` | Generate signed RSA-SHA256 checkpoint |
| `GET` | `/api/integrations` | Inventory of PostgreSQL, S3, and REST state readers |
| `GET` | `/api/webhooks` | Inbound webhook events, signatures, and lifecycle states |
| `GET` | `/api/scenarios` | Catalog of authoritative simulation scenarios (A–H) |
| `POST` | `/api/scenarios/:id/run`| Execute simulation scenario and store trace |
| `POST` | `/api/seed` | Seed initial demonstration runs for first-time explore |
