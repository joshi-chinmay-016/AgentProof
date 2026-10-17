# ADR-019: Visual Design System & Dark/Light Theming Architecture

## Status
Accepted

## Context
Phase 8 required a high-density, professional developer security console combining:
- The clarity and information density of an infrastructure observability platform.
- The precision and trust cues of a cryptographic security product.
- Complete support for both Dark mode and Light mode without theme flicker, low contrast, or unstyled widgets.
- WCAG AA accessibility compliance, keyboard shortcuts, and responsive layouts.

## Decision
1. **Semantic Token Architecture**:
   - We implemented a semantic CSS variable system in `public/styles/theme.css`.
   - Dark theme defaults to deep obsidian tones (`#090d16`, `#141d30`, `#19243c`) with cyan accents (`#06b6d4`).
   - Light theme maps semantic tokens to neutral cool slate surfaces (`#f8fafc`, `#ffffff`) with deep blue accents (`#0284c7`).
   - Standardized status tokens:
     - `--verdict-pass`: `#10b981` (Green)
     - `--verdict-fail`: `#ef4444` (Crimson Red)
     - `--verdict-inconclusive`: `#f59e0b` (Amber)
2. **Typography Stack**:
   - Primary: `Inter` for crisp body copy and operational scanning.
   - Monospace: `JetBrains Mono` for trace IDs, cryptographic hashes, timestamps, and JSON payloads.
3. **Micro-Interactions**:
   - Smooth sidebar collapse with tooltips.
   - Command palette (`Ctrl+K`) for rapid navigation.
   - Non-intrusive toast notifications.
   - Slide-in detail drawers and accessible modal dialogs with keyboard traps (`Esc` to close).

## Consequences
- **Positive**: Cohesive visual identity worthy of a Tier-1 developer security product.
- **Positive**: 100% theme coverage with zero unstyled surfaces across all views.
- **Positive**: Lightweight bundle with no bulky UI framework dependencies.
