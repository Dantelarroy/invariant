# Proposal: add-prompt-registry-and-rule-scores

## Why

Traces show what each model call cost and how long it took. They do not show which prompt text produced it, or which business rules the result broke. Without that, Langfuse cannot compare prompt versions or say which rule fails most, and a reviewer cannot see why a document was flagged. Day 12, part 1 links every generation to its prompt version and records every rule result as a score. Part 2, the review queue, builds on it.

## What Changes

- **Prompt registry in Langfuse, pinned in code.**
  - Our four prompts are seeded into Langfuse prompt management under family names: `extract-text` v1, `extract-document` v1 and v2, `repair` v1. So our id `extract-document-v2` is Langfuse `extract-document` version 2.
  - `pnpm prompts:seed` is idempotent. It creates missing versions, skips identical ones, and fails on drift (same version, different text).
  - Git stays the source of truth: runs ask Langfuse for the exact version the code pins. If Langfuse is off or unreachable, they use the local text.
- **Generations linked to their prompt.** Each extraction or repair generation carries the Langfuse prompt name and version. Langfuse then groups cost, latency and scores per prompt version.
- **Generations carry their data.** A pipeline generation records its input (prompt version and source text) and its output (the extracted invoice, canonical shape). Document bytes are still never sent (ADR-0011).
- **Rule results as scores.** After each verification, the verified generation gets:
  - one boolean score per rule (`rule.<id>`: passed or failed, with the violation messages as the comment and severity and details as metadata);
  - `rules.score` (0..1);
  - `rules.valid` (no error rule failed).

  Scores have deterministic ids, so retries update rather than duplicate. The same scores are sent for eval traces.

## Non-goals

- Editing prompts in the Langfuse UI to change runs (the `production` label driving runtime).
- Prompt variables and chat prompts. Prompts stay text-only instructions; the user message stays in code.
- The annotation queue, corrections, golden set and review sync (`add-review-queue`).

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `observability`: adds the prompt registry with pinned versions and fallback, prompt-linked generations with input and output, and rule scores.

## Impact

- **Code:**
  - `packages/observability`: a prompt resolver with fallback, a seed CLI, a scores client, and prompt link, input and output on `withGeneration`.
  - `packages/extractor`: prompts expose `{ name, version, text }`; the instructions can be passed in, so the extractor stays free of observability.
  - `apps/api`: the verify and repair steps send scores.
  - `packages/evals`: eval traces get scores.
- **Dependencies:** `@langfuse/client` 5.11.1 as a direct dependency, matching `@mastra/langfuse` 1.5.9.
- **ADRs:** relies on ADR-0005, ADR-0010 and ADR-0011. Adds ADR-0012, on why prompts are pinned in git with Langfuse as a registry, family naming, and the score design.
