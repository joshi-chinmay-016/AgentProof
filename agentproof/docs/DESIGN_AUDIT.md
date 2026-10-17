# AgentProof Design Audit: From "Template AI" to "Editorial Precision"

> **Auditor**: Principal Design Engineer & Lead Systems Architect  
> **Standard**: Anthropic, Linear, Stripe Dashboard, Google DeepMind Research  
> **Verdict on Previous UI**: Rejected First Draft. Lacks editorial authority, relies on default SaaS tropes, and obscures cryptographic rigor behind generic styling.

---

## 1. Visual Audit of Previous Implementation

An audit of the previous Phase 8 console screenshots (`#overview`, `#verifications`, `#evidence-audit`, `#scenarios`, `#help`) in both themes revealed eight recurring "template tells" that immediately betray an AI-generated or off-the-shelf component library:

### Tell 1: Uniform Card Grids (The "Bootstrap Dashboard" Syndrome)
- **Observed**: The Overview dashboard presented 5 identical rounded dark blue cards in a row (`Total`, `PASS`, `FAIL`, `INCONCLUSIVE`, `Completeness`), followed by a 3x2 grid of 6 identical scenario cards with identical button layouts.
- **Problem**: In real industrial instruments, information is not uniform in importance. Flattening distinct data streams (ratios, counts, timelines) into identically proportioned rectangles kills visual hierarchy.
- **Editorial Replacement**: Asymmetric, ruled sections. High-level metric numerals rendered in large Newsreader serif type with tabular alignment. Scenarios presented as a structured index/catalogue with varying visual weight rather than toy cards.

### Tell 2: Cold Cyan/Neon Glow Shadows (The "Crypto/Gamer Dark Mode")
- **Observed**: Deep blue-black background (`#0b101b`) with cyan (`#00e5ff`) accents, cyan box-shadow glows on card boundaries, and top-bar radial blue lighting.
- **Problem**: Glowing cyan implies entertainment, gaming, or crypto hype. AgentProof is a formal verification platform that evaluates system state against cryptographic ground truth. Glows erode trust and impair legibility.
- **Editorial Replacement**: Warm, ink-on-paper palette. Dark mode uses warm charcoal/near-black (`#14130F`, raised surfaces `#1C1B16`, hairlines `#2A2822`, text `#EDEAE2`). Light mode uses warm archival paper (`#FAF9F6`, surfaces `#F4F1EA`, hairlines `#E7E4DC`, ink `#1A1915`). Zero surface glow. Zero gradients.

### Tell 3: Accent Color Misuse & Decorative Color
- **Observed**: Cyan was sprayed across buttons, badges, links, active sidebar states, icons, and table IDs.
- **Problem**: When accent color is everywhere, it guides nowhere. Furthermore, semantic verdict colors (`PASS`, `FAIL`, `INCONCLUSIVE`) competed with the UI accent.
- **Editorial Replacement**: Exactly **ONE** primary accent: **Terracotta Clay** (`#C85A32` in light / `#D96B43` in dark). It is reserved strictly for primary actions, keyboard focus rings, and active selection state. Verdict colors are muted, authoritative, and reserved *strictly* for verification outcomes (`PASS`: `#23643E` / `#348B57`; `FAIL`: `#9E2A2B` / `#C74345`; `INCONCLUSIVE`: `#9A6B1F` / `#C9943B`).

### Tell 4: Generic System Sans-Serif Everywhere
- **Observed**: Default sans-serif font stack (Inter/Segoe UI) applied uniformly across display titles, metadata, tables, and metric counters.
- **Problem**: Looks like every admin template released since 2021. Lacks the intellectual authority and dignity of a technical instrument.
- **Editorial Replacement**: Refined serif (**Newsreader**) for display headlines, page titles, and large metric numerals; crisp geometric sans (**Geist Sans / Inter**) for UI labels and body text with tight tracking; monospace (**JetBrains Mono / Geist Mono**) with `font-variant-numeric: tabular-nums` for hashes, JSONPaths, condition expressions, timestamps, and IDs.

### Tell 5: Emoji Icons & Colored Circle Avatars
- **Observed**: Metric titles included emojis (🔍, 📊); navigation icons were wrapped in decorative backgrounds.
- **Problem**: Emojis communicate casual hobby projects, not enterprise-grade verification.
- **Editorial Replacement**: Single, disciplined 1.5px stroke icon set (Lucide/Phosphor) at 16px/20px only. Custom SVG geometric silhouettes for verdicts:
  - `PASS`: check-in-square
  - `FAIL`: x-in-square
  - `INCONCLUSIVE`: dashed-circle-with-question
  State is immediately readable without reliance on color (WCAG AA).

### Tell 6: Pill Radii Everywhere
- **Observed**: Buttons, badges, filters, and status tags were all pill-shaped (`border-radius: 9999px`) while cards were 16px rounded rectangles.
- **Problem**: Competing radii create visual dissonance and a "bubbly", juvenile feeling.
- **Editorial Replacement**: Exactly **two** radii in the entire design system:
  - `4px` for interactive controls, buttons, badges, chips, code snippets, inputs.
  - `10px` for panels, sheets, dialogs, and drawers.
  Zero pills.

### Tell 7: Lack of Asymmetry & Margin Discipline
- **Observed**: Every screen was a stacked column of full-width or equal-column boxes.
- **Problem**: Technical journals, research papers, and precision tools use margin columns for annotations, metadata, and cross-references.
- **Editorial Replacement**: Asymmetric editorial layout with wide margin labels, clear horizontal rules, tabular two-column detail views, and sticky context panels.

### Tell 8: Generic Marketing Copy & Placeholder Atmosphere
- **Observed**: "Seed Demo Runs", "Run Verification", "Actionable Attention Items".
- **Problem**: Fails to explain *why* independent verification matters or *how* it differs from model self-evaluations.
- **Editorial Replacement**: Rigorous, research-lab copy: *"An agent saying it worked is not proof it worked."* Clear mathematical and cryptographic definitions of postcondition satisfaction, evidence provenance, and hash chain tamper detection.

---

## 2. The New Design Direction: "Editorial Precision"

```
┌────────────────────────────────────────────────────────────────────────┐
│                          EDITORIAL PRECISION                           │
│                                                                        │
│   Typography:    Newsreader (Display/Numerals) + Geist Sans (UI)       │
│                  + JetBrains Mono (Data/Hashes/Tabular)                │
│                                                                        │
│   Palette Light: #FAF9F6 (Paper) · #F4F1EA (Surface) · #1A1915 (Ink)   │
│   Palette Dark:  #14130F (Charcoal) · #1C1B16 (Surface) · #EDEAE2      │
│   Single Accent: #C85A32 / #D96B43 (Terracotta Clay)                   │
│                                                                        │
│   Verdicts:      PASS (Deep Forest) · FAIL (Brick Red)                 │
│                  · INCONCLUSIVE (Ochre) with distinct SVG silhouettes  │
│                                                                        │
│   Radii:         4px (Controls/Badges) · 10px (Panels/Drawers)         │
│   Depth:         Hairlines (1px) + Tone Steps. No glow. No blur.       │
│   Motion:        100/160/240/400ms. Restrained ease. No spring.        │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Architecture & Routing Restructuring

To elevate AgentProof from a standalone console into an industry-defining product, we split the web surface into two dedicated environments sharing a unified design token system:

1. **Marketing Landing Page (`/`)**:
   - Editorial showcase communicating the core thesis: *"An agent saying it worked is not proof it worked."*
   - Interactive 3D WebGL / Three.js pipeline visualization with real-time scenario switching (Genuine Success, False Success, Missing Evidence).
   - Scroll-driven diff: *"What the agent said vs What the system actually contains."*
   - Ruled table breakdown of the Three Authoritative Verdicts (`FAIL > INCONCLUSIVE > PASS`).
   - Live code blocks of MCP-native tools (`verify_outcome`, `inspect_trace`, etc.).
   - Cryptographic tamper-evident hash chain interactive demo.
   - Rigorous Trust Model: *"What AgentProof establishes / What it does not claim."*

2. **Console Platform (`/app`)**:
   - The full-featured developer security console moved under `/app` (with hash and deep link routing: `/app#overview`, `/app#verifications`, `/app#evidence-audit`, `/app#integrations-webhooks`, `/app#scenarios`, `/app#help`).
   - Restyled to Editorial Precision standards: Newsreader numerals, hairline tables, monospace ID copy-on-click, side-by-side postcondition diffs, verdict driver highlight banner.

3. **Component Spec & System Showcase (`/dev/components`)**:
   - Dedicated interactive design system laboratory displaying every component in all interactive states (default, hover, active, focus-visible, disabled, loading) across both themes.

---

## 4. Migration Plan & Step Sequence

1. **Step 1 — Design Tokens & Foundations (`theme.css`)**:
   - Define CSS custom properties for Light Paper and Dark Charcoal.
   - Configure Newsreader, Geist Sans, and JetBrains Mono typography.
   - Implement 4px/10px radii, hairline borders, and AA contrast verdict tokens.
2. **Step 2 — Component Kit & Showcase (`/dev/components`)**:
   - Build buttons, verdict badges, observation chips, postcondition diff rows, data tables, filter chips, command palette, toasts, and empty state illustrations.
3. **Step 3 — Marketing Landing Page (`/`)**:
   - Build editorial hero, interactive 3D WebGL verification pipeline, scroll diff section, ruled verdict table, MCP code blocks, and trust model.
4. **Step 4 — Console Restyling (`/app`)**:
   - Overhaul Overview, Verifications, Evidence & Audit, Integrations, and Scenarios using the new components.
5. **Step 5 — Testing, A11y, and Visual Verification**:
   - Run Vitest suites, TypeScript typecheck, smoke tests, and Playwright screenshots across both themes.
