# Design

## Context

- `apps/api/src/mastra.ts` builds `new Mastra({ storage, logger: false, workflows })` with no observability. The workflow steps are ingest, extract, verify, repair, human-review and persist (`apps/api/src/workflows/process-document.ts`).
- `@mastra/core` 1.69.0 supports `observability: new Observability({ configs: { langfuse: { serviceName, exporters: [new LangfuseExporter({...})] } } })`.
  - It creates `WORKFLOW_RUN` and `WORKFLOW_STEP` spans automatically.
  - `run.start({ tracingOptions: { metadata, tags } })` sets the trace metadata.
  - Steps receive `tracingContext.currentSpan`, which can create `MODEL_GENERATION` child spans and reach the root span with `findParent`.
- Our model calls are plain AI SDK `generateText` calls inside `@invariant/extractor`. Mastra does not trace them by itself.
- The `LangfuseExporter` defaults `baseUrl` to Langfuse Cloud, so it must be set explicitly.
- Langfuse v4's price table covers `gpt-5-mini` and `gpt-5`. Cost is inferred from `model` + input/output usage, so we do not compute it.
- The eval runner (`packages/evals`) calls the extractor directly, without Mastra.
- Langfuse v4 self-hosting needs web, worker, Postgres ≥ 15, ClickHouse ≥ 25.12, Redis ≥ 7 and S3 (MinIO). Headless init uses the `LANGFUSE_INIT_*` variables on the web container. The official sizing is 16 GB, which is production sizing.
- WSL now has 5 GB.

## Goals / Non-Goals

**Goals:**
- Tracing must never change pipeline behavior, and a Langfuse outage must never fail a run. Export errors are logged, not thrown.
- The extractor stays free of observability dependencies.
- The whole stack starts with one command and needs no clicks.

**Non-Goals:**
- Distributed tracing across services, OpenTelemetry for the AI SDK (`@ai-sdk/otel` + bridge), and dashboards built in the UI.

## Decisions

1. **A separate compose stack, `infra/langfuse`,** with its own Postgres. The official v4 compose is trimmed and adapted:
   - Images pinned: `langfuse/langfuse` and `langfuse-worker` 4.47.0, ClickHouse 25.12, Redis 7, Postgres 17, MinIO.
   - Only web (`127.0.0.1:3000`) and MinIO (`127.0.0.1:9090`, for presigned uploads) are published.
   - Memory caps: `mem_limit` on every service, `NODE_OPTIONS=--max-old-space-size=512` on web and worker, and a ClickHouse `config.d` capping server memory near 1 GB with system log tables off.
   - `TELEMETRY_ENABLED=false`.
   - Credentials are fixed, local-only values written in the compose file. This follows the root and ERP stacks and keeps setup scriptable without env files.
   - *Alternative:* reuse `invariant-postgres`. It saves about 100 MB but couples lifecycles and needs a manual `CREATE DATABASE`.
2. **Opt-in through `LANGFUSE_BASE_URL`.** `createObservability()` returns `undefined` when it is unset, and nothing is registered.
   - The public and secret keys default to the local-only headless-init keys and can be overridden through `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY`.
   - The environment is `pipeline` for the workflow and `eval` for the eval runner.
3. **Generation spans are recorded by the steps.**
   - `extractWithModel` returns, in addition, `modelId` (from the response) and `latencyMs`.
   - The extract and repair steps wrap their call in `withGeneration(tracingContext, { name: promptVersion, model }, fn)`. It creates a `MODEL_GENERATION` child span and ends it with usage `{ input, output }` and the model id, or with the error.
   - Only input and output totals are sent, never reasoning tokens separately, to avoid double-counting cost.
   - *Alternatives:*
     - moving calls to Mastra Agents is heavier and changes the extractor;
     - `@ai-sdk/otel` needs a second export path.
4. **Trace metadata and branch.**
   - `processDocument` starts runs with `tracingOptions: { metadata: { filename, model }, tags: ["pipeline"] }`.
   - The ingest step adds `documentId`.
   - Steps that end a run set the branch on the root span (`findParent(WORKFLOW_RUN)`) as metadata and as a tag: persist for `accepted` / `repaired` / `rejected`, human-review for `needs_review`, extract for `failed`, and ingest for `duplicate`.
   - A resumed run gets its own final branch.
5. **Eval tracing.** `createEvalTracer()` uses `@langfuse/tracing` with a `LangfuseSpanProcessor` on a Node tracer provider.
   - There is one trace per document (name = document id, environment `eval`), with a generation per model call.
   - The trace metadata holds the dataset, model, prompt version, exact match and rule verdict. The input is a short description (file name and media type), never the bytes.
   - Traces are flushed at the end of the run.
6. **Report computed locally.**
   - `pnpm obs:report --since <ISO> [--env eval|pipeline]` pages through the Langfuse public API: traces, plus observations of type generation.
   - It computes the counts, the total cost, and p50/p95 of trace latency per model, per generation name and per branch, using nearest-rank percentiles.
   - It retries briefly until the trace count stops changing, because ingestion is asynchronous.
   - *Alternative:* the Metrics API. Its filtering by metadata is unverified, and local computation over 50 traces is trivial and testable.
7. **Flush on exit.** The CLIs (`extract:text`, `review`, `eval:extract`) call `mastra.shutdown()` or the tracer flush before the process exits.

## Risks / Trade-offs

- **Memory pressure at 5 GB:** ClickHouse and two Node services next to Postgres and the validator. → Mitigation: caps, the documented "ERP stack off while Langfuse runs" rule, and `langfuse:down` when not in use.
- **Headless init details can differ between Langfuse versions.** → Mitigation: a smoke script checks health and a public API call with the local keys.
- **Asynchronous ingestion** can make the report undercount. → Mitigation: the retry-until-stable loop, and the report prints the count it saw.
- **Trace inputs contain invoice text** (synthetic now, real later). → Mitigation: self-hosted and local only. Document bytes are excluded. ADR-0011 records that real-data traces stay local.
- **Mastra's suspend/resume tracing** is not proven end to end. → Mitigation: an integration test checks that a resumed run's final branch is set, with the exporter replaced by an in-memory one.

## Migration Plan

Additive and opt-in. Without `LANGFUSE_BASE_URL`, nothing changes. Rollback means reverting the PR and running `langfuse:down -v`.

## Open Questions

- Whether to send rule results as Langfuse scores. That is planned for day 12 and does not change this change's specs.
