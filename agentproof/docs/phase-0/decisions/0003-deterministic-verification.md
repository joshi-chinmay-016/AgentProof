# ADR 0003: Deterministic Rules as Primary Verification Authority

**Status:** Approved  
**Date:** 2026-10-17  
**Deciders:** Principal Architect, AI Safety Specialist  

---

## Context
Many emerging agent evaluation frameworks rely on LLMs to grade other LLMs ("LLM-as-a-Judge"). In verification, however, the goal is to establish whether an operational action (e.g., updating a customer subscription, granting an IAM role) actually took place in ground-truth reality.

## Decision
We decide that **deterministic, typed predicate rules are the sole and final verification authority in AgentProof.**

Verdicts (`PASS`, `FAIL`, `INCONCLUSIVE`) are calculated by strictly evaluating mathematical and logical predicates (e.g., equality, numeric threshold, membership, schema validity) against independently observed state snapshots. Probabilistic LLM evaluations are **never** permitted to override or determine the verification verdict.

## Alternatives Considered
1. **LLM-as-a-Judge Core Evaluator:**
   - *Pros:* High flexibility for fuzzy natural language queries.
   - *Cons:* Nondeterministic, introduces prompt injection vulnerabilities, subject to stochastic drift, expensive, slow (several seconds per evaluation), and cannot be formally proved.
2. **Hybrid Weighted Scoring (Deterministic + LLM Score):**
   - *Pros:* Blends hard checks with semantic nuance.
   - *Cons:* Blurs epistemic truth; an action that failed in the database could receive a "passing" grade if the LLM awards high scores for conversational fluency.

## Consequences
- **Positive:**
  - 100% reproducible evaluations across repeated test runs.
  - Immune to adversarial prompt injection in tool payloads.
  - Sub-millisecond evaluation latency.
  - Mathematically sound audit trails suitable for enterprise compliance.
- **Negative:**
  - Postconditions must be formally specified with structured paths and typed operators rather than loose natural language prompts.

## Revisit Conditions
Optional LLM assistance may be introduced in future phases *strictly for secondary purposes*, such as generating human-readable narrative explanations or suggesting postcondition schemas during authoring, but **never** for determining the truth value of a verdict.
