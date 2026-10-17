# AgentProof Design System: Editorial Precision

> **Specification & Component Architecture**  
> **Brand & Philosophy**: Calm, exact, confident. Reads like a well-typeset technical journal, engineered for cryptographic proof and independent postcondition verification.

---

## 1. Design Tokens

### Color Tokens (CSS Custom Properties)

AgentProof designs Light Paper and Dark Warm Charcoal independently rather than inverting values:

| Token Name | Light Paper Theme | Dark Warm Charcoal Theme | Role / Description |
| :--- | :--- | :--- | :--- |
| `--bg-canvas` | `#FAF9F6` | `#14130F` | Page root canvas |
| `--bg-surface` | `#FFFFFF` | `#1C1B16` | Main panels, cards, tables |
| `--bg-surface-raised`| `#F4F1EA` | `#24221C` | Secondary containers, headers |
| `--bg-surface-sunken`| `#ECE8DE` | `#0E0D0A` | Deep wells, code blocks |
| `--border-hairline` | `#E7E4DC` | `#2A2822` | Structural 1px division lines |
| `--border-subtle` | `#D8D4C8` | `#38352D` | Hover states and active edges |
| `--text-primary` | `#1A1915` | `#EDEAE2` | High-contrast prose and titles |
| `--text-secondary` | `#66635A` | `#9E9B90` | Explanatory labels and subtitles |
| `--text-muted` | `#8C887B` | `#78756C` | Timestamps, metadata, hints |
| `--accent` | `#C85A32` | `#D96B43` | **Terracotta Clay**: Only for primary actions & focus |
| `--verdict-pass` | `#23643E` | `#3FA86B` | Authoritative PASS outcome (Forest Green) |
| `--verdict-fail` | `#9E2A2B` | `#E05355` | Authoritative FAIL outcome (Brick Red) |
| `--verdict-inconclusive`| `#9A6B1F` | `#D4A347` | Authoritative INCONCLUSIVE outcome (Ochre) |

### Observation State Tokens (Evidence Probes Only)

| Token Name | Hex Value | Semantic Meaning |
| :--- | :--- | :--- |
| `--obs-found` | `#2B5E41` / `#4CA874` | Resource state confirmed in external reader |
| `--obs-not-found` | `#8A2D2E` / `#E06567` | Resource missing / 404 in target system |
| `--obs-read-error` | `#8A4E1B` / `#E59850` | Connection timeout / network failure |
| `--obs-untrusted` | `#5C527F` / `#9A8ED4` | Signature mismatch / replay attack / invalid origin |

---

## 2. Typography System

- **Display & Large Numerals**: `Newsreader`, `Fraunces`, serif. Used for headlines, section titles, and KPI numerals (`font-variant-numeric: tabular-nums`).
- **User Interface & Controls**: `Geist Sans`, `Inter`, sans-serif. Tight tracking (`-0.015em`) for dense readability.
- **Data, Hashes, & Expressions**: `JetBrains Mono`, `Geist Mono`, monospace with tabular numerals for condition expressions, SHA-256 hashes, timestamps, and raw JSON payloads.

---

## 3. Geometry & Spacing Rules

1. **4px Spacing Grid**: All margins, padding, and gaps are multiples of 4px (`--space-1`: 4px to `--space-40`: 160px).
2. **Two Radii Only**:
   - `4px` (`--radius-sm`): Controls, buttons, inputs, filter chips, verdict badges, code blocks.
   - `10px` (`--radius-lg`): Panels, drawers, dialogs, sheets.
   - Zero pill shapes (`9999px` is banned).
3. **Depth without Shadows**: Elevation is achieved via 1px hairline borders (`--border-hairline`) and surface background tone steps. Exactly one soft shadow (`--shadow-popover`) is permitted for floating menus.

---

## 4. Component Specifications

### 4.1 Buttons
- Heights: `32px` (`.btn-sm`), `36px` (`.btn-md`), `40px` (`.btn-lg`).
- Variants:
  - `Primary`: Solid Terracotta Clay (`--accent`).
  - `Secondary`: Hairline outline with surface background.
  - `Ghost`: Borderless with hover tone shift.
  - `Destructive`: Hairline brick red outline.
  - `Icon`: 32px or 36px square control.
- States: Default, Hover (120ms tone shift), Active (`translateY(1px)`), Focus-Visible (2px offset ring in accent), Disabled (`opacity: 0.45`), Loading (locked width, animated spinner).

### 4.2 Authoritative Verdict Badges
- Format: Unique SVG silhouette glyph + uppercase monospace label + hairline border + ~8% tinted background.
- Sizes: `20px` (`badge-sm`), `24px` (`badge-md`), `28px` (`badge-lg`).
- Silhouette Glyphs:
  - `PASS`: check-in-square
  - `FAIL`: x-in-square
  - `INCONCLUSIVE`: dashed-circle-with-question
- Rule: **Never reused for non-verdict states.**

### 4.3 Observation Status Chips
- Format: Small solid colored dot + monospace status text + hairline border + **NO background fill**.
- Rule: Visually differentiated from verdict badges to prevent confounding evidence states with authoritative verdicts.

### 4.4 Postcondition Diff Rows
- Displays: Postcondition path expression, operator, expected vs observed values side-by-side with diff color coding, and freshness window.
- Expandable: One-click expansion reveals raw evidence payload snippet.

### 4.5 Precision Tables
- Sticky headers (`36px` height, uppercase monospace labels).
- Row hover with instant action reveal.
- Monospace IDs with inline "Copied" swap (toast-less).
- Keyboard row navigation (`j` / `k`, `Enter`).

---

## 5. Motion Guidelines

- **Durations**: 100ms (micro/hover), 160ms (controls), 240ms (drawers/menus), 400ms (draw-in), 700ms (hero reveal).
- **Easings**: Standard `cubic-bezier(0.2, 0, 0, 1)`, Emphasized `cubic-bezier(0.16, 1, 0.3, 1)`, Exit `cubic-bezier(0.4, 0, 1, 1)`.
- **Reduced Motion**: Full support via `@media (prefers-reduced-motion: reduce)` collapsing transitions to static zero-duration equivalents.
