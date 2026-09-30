# Tasks

## 1. Prompt definitions and registry

- [x] 1.1 RED/GREEN: prompt files export `{ name, version, text }`, `*_PROMPT_VERSION` is derived and unchanged, and the extractor functions accept an optional `instructions`. Verify that the existing extractor tests pass unchanged and that the new tests pass (`pnpm test packages/extractor`).
- [x] 1.2 RED/GREEN: `resolvePrompt` with a fake client. Verify with `pnpm test packages/observability`. Cases:
  - tracing off: local text, no call;
  - registry text returned with a link;
  - fallback: local text, no link;
  - drift: local text, a warning, a link.
- [x] 1.3 RED/GREEN: seed planning as a pure function, `plan(local, remote)` → skip, create or drift-fail, where a failure blocks all writes, with tests. Then the `prompts:seed` CLI. Verify by running it twice against local Langfuse: the first run creates 4 versions and the second creates none.

## 2. Generation data and prompt link

- [x] 2.1 RED/GREEN: `withGeneration` records input, output and the prompt link, and returns the span id. The extract and repair steps and the eval runner pass them, with no bytes for files. Verify with `pnpm test packages/observability apps/api packages/evals`.

## 3. Rule scores

- [x] 3.1 RED/GREEN: `sendRuleScores` with a fake `fetch`: 9 scores with names, values, types, comment and metadata; deterministic ids; errors logged, not thrown. Verify with `pnpm test packages/observability`.
- [x] 3.2 Wire the scores into the verify and repair steps and into the eval runner, awaiting them in `close()`. Add a workflow test with a fake score sink: a wrong total gives `rule.total=false` and `rules.valid=false`, and a repaired document scores both generations. Verify with `pnpm test apps/api`.
- [x] 3.3 Write ADR-0012 and link it from `docs/architecture.md`, and add a "Prompts and scores" section to `docs/observability.md`. Verify that the links resolve.

## 4. Check

- [x] 4.1 With Langfuse up: run `pnpm prompts:seed`, then process one text fixture copy. Verify through the API that the generation has the prompt link, input and output, and the 9 scores. Then run `pnpm lint && pnpm typecheck && pnpm test && pnpm py:check`, open the PR and confirm that CI is green.
