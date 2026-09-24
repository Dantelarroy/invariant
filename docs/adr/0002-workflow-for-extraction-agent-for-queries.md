# ADR-0002: Deterministic workflow for extraction, agent only for queries and actions

- **Status:** Accepted
- **Date:** 2026-09-24

## Context
LLM systems can be built as fixed workflows (code decides the steps) or as agents (the model decides the steps). Extraction must be cheap, predictable, observable and evaluable per step; querying the ledger ("which supplier raised prices?") is open-ended.

## Decision
- The document pipeline (ingest → extract → verify → repair → ask human → persist) is a **deterministic mastra workflow**. The model is called at fixed steps; control flow lives in code, driven by rule results.
- An **agent** is used only on top of the ledger, for open-ended questions and actions, with typed tools also exposed over MCP.

## Consequences
- Each pipeline step can be traced, costed and evaluated in isolation; failures are reproducible.
- Repair is bounded (max one retry with a clean, targeted prompt) instead of open-ended agent loops, avoiding context contamination and cost spikes.
- The agent needs its own evals (tool choice and answer correctness).
