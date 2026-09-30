# Tasks

## 1. Local Langfuse stack

- [ ] 1.1 Add `infra/langfuse/docker-compose.yml` (images pinned per design 1, binds to 127.0.0.1, `mem_limit`s, ClickHouse low-memory `config.d`, `TELEMETRY_ENABLED=false`, headless init with local-only org, project, user and keys) and the root scripts `langfuse:up` / `langfuse:down`. Verify that `pnpm langfuse:up` becomes healthy, that `GET /api/public/health` answers, and that an authenticated public API call with the local keys succeeds.
- [ ] 1.2 Record the idle memory of each container (`docker stats --no-stream`) with Postgres and the validator up, and put it in `docs/observability.md`. Verify that the total fits under the 5 GB WSL limit.

## 2. `@invariant/observability` and extractor timing

- [ ] 2.1 RED/GREEN: `extractWithModel` also returns `modelId` and `latencyMs`. Existing extractor tests keep passing, and a new test asserts both fields with a mock model. Verify with `pnpm test packages/extractor`.
- [ ] 2.2 Scaffold `packages/observability` with the pinned dependencies. Verify with `pnpm install && pnpm typecheck`.
- [ ] 2.3 RED/GREEN, with an in-memory exporter or fake span objects: verify with `pnpm test packages/observability`. Cover:
  - `createObservability(env)` returns `undefined` without `LANGFUSE_BASE_URL`, and a config pointing at that URL with it;
  - `withGeneration` ends the span with model, usage and name on success, and with the error on failure, rethrowing the original error;
  - `setBranch` writes the metadata and the tag on the root span.

## 3. Workflow and eval tracing

- [ ] 3.1 RED/GREEN, a workflow test with an in-memory exporter: an accepted run has the six step spans, one generation named `extract-text-v1` and branch `accepted`; a repaired run has two generations and branch `repaired`; a paused run has branch `needs_review`. Wire `createObservability` into `createInvariantMastra`, `tracingOptions` into `processDocument` / `reviewDocument`, `withGeneration` into extract and repair, `setBranch` into the terminal steps, and flush in the CLIs. Verify with `pnpm test apps/api`.
- [ ] 3.2 RED/GREEN: `createEvalTracer` for the eval runner. Verify with `pnpm test packages/evals`. Cover:
  - one trace per document with its generation(s) and metadata, and no bytes in the input (a fake processor test);
  - with tracing off, the runner behaves exactly as before.
- [ ] 3.3 Write `docs/adr/0011-observability.md` (self-hosted and opt-in, trace contents, branch, bytes excluded, real data stays local) and link it from `docs/architecture.md`. Verify that the link resolves.

## 4. Report and the 50-document run

- [ ] 4.1 RED/GREEN: the pure report aggregation (counts, total cost, nearest-rank p50/p95 per model, generation name and branch) with fixture traces; then the `obs:report` CLI over the public API with the retry-until-stable loop. Verify with `pnpm test packages/observability`.
- [ ] 4.2 With Langfuse up and tracing on, run `pnpm eval:extract --dataset data/synth-erp --limit 50` and process both text fixtures through the workflow (use copies if they are duplicates). Then run `pnpm obs:report`. Verify that Langfuse shows 50 eval traces and the pipeline traces with their branches.
- [ ] 4.3 Write `docs/observability.md`: how to start and stop, how to turn tracing on, the report output from 4.2, and a short walkthrough from a `needs_review` trace to its cause. Verify that the walkthrough steps match the UI.
- [ ] 4.4 Integration: run `pnpm lint && pnpm typecheck && pnpm test && pnpm py:check` without `LANGFUSE_BASE_URL`, confirming tracing off changes nothing. Open the PR and confirm that CI is green.
