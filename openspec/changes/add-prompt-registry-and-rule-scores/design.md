# Design

## Context

- Prompts live in `packages/extractor/src/prompts/*.ts` as `{ INSTRUCTIONS, PROMPT_VERSION }` constants. The extractor must not depend on observability (ADR-0011).
- `withGeneration` (`packages/observability/src/spans.ts`) creates a `MODEL_INFERENCE` span with `responseModel` and `usage`, but no input or output.
- `@mastra/langfuse` 1.5.9 maps span `metadata.langfuse.prompt{name,version}` to the observation's prompt link, and this works on `MODEL_INFERENCE` spans. A link to a missing prompt ingests without error.
- Langfuse prompt API facts (verified on 4.47.0):
  - `POST /api/public/v2/prompts` always creates a new version. It never deduplicates.
  - `GET /api/public/v2/prompts/{name}?version=N` fetches an exact version.
  - `@langfuse/client` `prompt.get(name, { version, fallback, fetchTimeoutMs, maxRetries })` returns a fallback prompt (`isFallback`) when the fetch fails.
- Score facts (verified):
  - `POST /api/public/scores` accepts `{ id, traceId, observationId, name, value, dataType, comment, metadata, environment }`, and the same `id` upserts.
  - Mastra's own score path forces NUMERIC, so it cannot send booleans.
- Inside a step, `tracingContext.currentSpan` exposes `traceId` and the span `id`, which equals the Langfuse observation id.

## Goals / Non-Goals

**Goals:**
- Evals stay reproducible: the prompt text is whatever the code pins.
- Registry, scores or network problems never fail or noticeably slow a run.

**Non-Goals:**
- A UI-driven prompt workflow (labels), or A/B routing between prompt versions.

## Decisions

1. **Prompt definitions.**
   - Each prompt file exports `{ name, version, text }`, for example `{ name: "extract-document", version: 2 }`, plus the existing `*_PROMPT_VERSION` string, derived as `${name}-v${version}` so existing reports keep their ids.
   - The extractor functions accept an optional `instructions` override. The default is the local text.
2. **Resolver.** In `@invariant/observability`, `resolvePrompt(def, env)` does the following:
   - With tracing off, it returns `{ text: def.text, link: undefined }` with no network call.
   - Otherwise it calls `prompt.get(name, { version, fallback: def.text, fetchTimeoutMs: 2000, maxRetries: 0 })` and caches the result per process.
   - If the fetched text differs from local, it logs a drift warning and uses local, because git wins.
   - It returns `link: { name, version }` only when the registry served that version.
3. **Seed CLI.** `pnpm prompts:seed` is written in Node, not curl, because curl mangled `€`. For each family, in version order:
   - An existing version with equal text is skipped.
   - An existing version with different text fails the whole run.
   - A missing version N is created only if N−1 exists. Its config is `{ promptVersion: "<family>-vN" }`.
   - All checks run before any write, so a failing run changes nothing.
4. **Generation data.**
   - `withGeneration` gains `input`, `prompt` (the link) and an output mapper.
   - The extract and repair steps pass the input `{ promptVersion, text }` and the output `invoice`.
   - The eval runner passes `{ promptVersion, file, mediaType }`, never bytes.
   - `withGeneration` returns the span id, so scores can target it.
5. **Scores.** `sendRuleScores({ traceId, observationId, verification, environment })` posts 9 scores through the public API, over `fetch` with Basic auth like `langfuse-api.ts`:
   - `rule.<id>` × 7, as `BOOLEAN`;
   - `rules.score`, as `NUMERIC`;
   - `rules.valid`, as `BOOLEAN`.

   It runs fire-and-forget, with errors logged. The id is `${observationId}-${name}`.
   - The workflow's verify step scores the extraction, and the repair step scores the repaired generation.
   - The eval runner scores each document's generations.
   - `close()` awaits pending score requests.
6. **ADR-0012** records:
   - git-pinned prompts with Langfuse as a registry, and why `production` labels do not drive runtime;
   - family naming;
   - the score design (per generation, booleans per rule, deterministic ids).

## Risks / Trade-offs

- **Seeding order locks history.** A future `extract-document-v3` must be seeded after v2. → Mitigation: the seed script enforces order and fails loudly.
- **Nine score requests per generation.** They are small, local and asynchronous. → Mitigation: they are awaited only at `close()`.
- **Source text in generation input** grows ClickHouse. It is fine for local, self-hosted use (ADR-0011). → Mitigation: document bytes stay excluded.
- **Drift between Langfuse and code** after someone edits the UI. → Mitigation: git wins at runtime, a warning is logged, and the seed fails on drift.

## Migration Plan

- Run `pnpm prompts:seed` once after `langfuse:up`.
- Existing traces keep their data. New generations get links, data and scores.
- Rollback means reverting the PR. Seeded prompts can stay.

## Open Questions

- None.
