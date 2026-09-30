# ADR-0012: Prompts pinned in git with Langfuse as a registry, and rule results as scores

- **Status:** Accepted
- **Date:** 2026-09-30

## Context
Traces (ADR-0011) show what each model call cost and how long it took. They do not show which prompt text produced a generation, or which business rules (ADR-0005) its result broke. So Langfuse cannot compare prompt versions or tell which rule fails most, and a reviewer cannot see why a document was flagged.

Prompts live in `packages/extractor/src/prompts/`, one file per version. Eval reports and stored invoices identify them by id (`extract-document-v2`). Evals must stay reproducible: a result must come from the prompt text in git at that commit.

Langfuse prompt management stores prompts by name with numbered versions. `POST /api/public/v2/prompts` always creates a new version and never deduplicates (verified on 4.47.0). A generation links to a prompt through its name and version. Langfuse scores attach to a trace or observation and can be `NUMERIC` or `BOOLEAN`; the same score id updates the score. Mastra's own score path only sends `NUMERIC` scores.

## Decision
1. **Git is the source of truth; Langfuse is a registry.**
   - Each prompt file exports `{ name, version, text }`. The old id is derived as `<name>-v<version>`, so reports and stored invoices keep their ids.
   - Runs ask Langfuse for the exact version the code pins, with a 2 s timeout, no retries and the local text as fallback. Each version is asked for once per process.
   - Tracing off: no call. Registry down or version missing: the local text, and the generation is not linked. Registry text differs from the code: a drift warning, the local text, and the link.
   - The `production` label does not drive runtime. Editing a prompt in the UI must not change what a run or an eval does; a new wording is a new version in git.
   - The extractor stays free of observability: its functions accept an optional `instructions` override, and the caller resolves the prompt.
2. **Family naming.** Langfuse prompt names are families (`extract-text`, `extract-document`, `repair`), and Langfuse version N is our `<family>-vN`. Superseded versions (`extract-document` v1) stay registered, so old generations and reports keep their meaning.
3. **Idempotent seed.** `pnpm prompts:seed` plans before it writes. A registered version with the same text is skipped; one with other text is drift and fails the run; a missing version is created only when Langfuse would give it that number (it follows the family's highest version). Any error means nothing is written. The plan is a pure, tested function.
4. **Generations carry their prompt and data.** Each extraction and repair generation links its registry prompt (span metadata `langfuse.prompt`, which `@mastra/langfuse` maps to the observation's prompt link), and records its input (`{ promptVersion, source }` in the workflow, where `source` is the document text: an input with a `text` or `messages` key is turned into chat messages by the OpenTelemetry export, dropping the prompt version; `{ promptVersion, file, mediaType }` in evals) and its output (the invoice in canonical shape). Document bytes are still never sent (ADR-0011).
5. **Rule results as scores, per generation.**
   - After each verification, the verified generation gets `rule.<id>` for every rule (`BOOLEAN`, 1 when it held; violation messages as comment, severity and details as metadata), `rules.score` (`NUMERIC`, the verifier score) and `rules.valid` (`BOOLEAN`, no error rule failed).
   - Scores target the generation, not the trace, so a repaired document shows the extraction's and the repair's results side by side. Eval traces get the same scores.
   - Booleans per rule, rather than one numeric score, let Langfuse count failures per rule and filter traces by the rule that failed.
   - The score id is `<observationId>-<name>`, so sending again updates instead of duplicating.
   - Scores are posted with `fetch` to `POST /api/public/scores`, fire-and-forget with a 5 s timeout; failures are logged. `close()` and the eval tracer's `shutdown()` wait for pending requests.

## Consequences
- Langfuse groups cost, latency and scores per prompt version, and a flagged trace shows which rules failed on which generation.
- A new prompt version needs one more step: seed it after merging (`pnpm prompts:seed`). The seed enforces the order and fails loudly otherwise.
- Nine small score requests per generation; they run concurrently and are awaited only at exit.
- Workflow generations now store the source text in Langfuse's ClickHouse. It stays local (ADR-0011).
- Someone editing a prompt in the UI changes nothing at runtime; the next run warns about drift and the next seed fails.
