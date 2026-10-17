# ADR-020: Signature Verification Pipeline Visualization & Cryptographic Integrity

## Status
Accepted

## Context
A primary goal of Phase 8 was to make AgentProof's verification model intuitive and observable for new and returning engineers.
AgentProof operates on a 4-step pipeline:
`Claimed Action` ➔ `Required Postconditions` ➔ `Independent Evidence` ➔ `Deterministic Verdict`

We needed a signature visual interaction that:
1. Accurately communicates this architectural model without misleading users.
2. Clearly distinguishes unverified agent self-reports from independently observed ground truth.
3. Provides an interactive, educational tool rather than decorative marketing eye-candy.
4. Explains the critical security invariant: local hash chains detect mid-chain tampering, but signed checkpoints are required to detect full-history rewrite attacks.

## Decision
1. **Interactive Verification Pipeline**:
   - Implemented an interactive 4-stage pipeline visualization in the Evidence & Audit view.
   - Clickable nodes with progressive disclosure: selecting a stage reveals detailed explanations of the inputs, transformations, and failure modes at that step.
2. **Audit Hash-Chain Visualizer**:
   - Displays sequential block linkages (`Genesis` ➔ `Sequence #1` ➔ `Sequence #2` ➔ `Head`).
   - Includes on-demand "Verify Chain Integrity" trigger connected directly to `AuditChainVerifier.verifyChain(events, tenantId)`.
3. **Signed RSA-SHA256 Checkpoints**:
   - Integrates `AuditCheckpointManager` to allow users to generate and inspect signed checkpoints of chain heads.
   - Clarifies that local SHA-256 links protect against tampering, while asymmetric signatures protect against historical rollbacks.

## Consequences
- **Positive**: Immediate educational value for developers evaluating AgentProof.
- **Positive**: Demonstrates real cryptographic security controls with zero fake mockups.
- **Positive**: Fully responsive across mobile, tablet, and desktop viewports.
