# ADR-0011: Self-hosted, opt-in tracing with Langfuse

- **Status:** Accepted
- **Date:** 2026-09-30

## Context
A failed or slow document left no trail: we saw the final outcome and, in evals, a JSON report, but not which step took the time, which model call cost what, or why a run ended in review. Production AI systems are debugged and improved from traces.

The workflow runs on mastra (ADR-0002), with durable suspend/resume for review (ADR-0003). Its model calls are plain AI SDK `generateText` calls inside `@invariant/extractor`, which mastra does not trace by itself. The eval runner calls the extractor directly, without mastra. Trace inputs contain invoice text, synthetic today and real later.

We must decide where traces go, when tracing is on, what a trace contains, and what never leaves the machine.

## Decision
1. **Self-hosted Langfuse v4, local only.** A separate compose stack (`infra/langfuse`) runs web, worker, Postgres, ClickHouse, Redis and MinIO, pinned to Langfuse 4.47.0. Only the web app and MinIO are published, on `127.0.0.1`. Setup is headless with fixed local-only credentials, like the other local stacks. Memory is capped for an 8 GB laptop; the ERP stack and Langfuse are not run together. No Langfuse Cloud.
2. **Opt-in through `LANGFUSE_BASE_URL`.** Without it nothing is registered and no network call is made, so tests and CI are unchanged. The keys default to the local-only ones and can be overridden with `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY`. The exporter's base URL is always explicit, because its default is Langfuse Cloud.
3. **Tracing never changes a run.** Tracing calls are wrapped so an error in them is logged, never thrown. An unreachable Langfuse only delays process exit while the final flush gives up (a few seconds). The CLIs flush traces before they exit.
4. **One trace per workflow run.** mastra creates the run and step spans. `@invariant/observability` adds:
   - a span per model call (extraction and repair) that Langfuse shows as a generation named after the prompt version, ending with the model id the provider answered with and the input and output token totals. It is a mastra `MODEL_INFERENCE` span with the model in `responseModel`: with `@mastra/core` 1.69 and `@mastra/observability` 1.18, only that span type carries model and usage into the export, and a `model` attribute would rename it to `chat <model>`. Only totals are sent: Langfuse infers the cost from model and usage, and sending reasoning tokens separately would count them twice. The extractor now returns the model id and latency with its result and stays free of observability dependencies;
   - trace metadata: document id, model, prompt version of the chosen extraction and, when given, the file name;
   - a **branch**, as metadata and as a tag, set by the step that ends the run: `accepted` and `repaired` (persist), `rejected` (persist), `needs_review` (human-review), `failed` (extract) or `duplicate` (ingest). A later call replaces the branch, so a trace carries one.
   - The human-review step records its review request, with the question, as its span output, because a suspended step ends without one.
   - A resumed run is traced by mastra as its own run, linked to the suspended one, and gets its own final branch.
5. **One trace per evaluated document.** The eval runner takes optional tracing hooks; `createEvalTracer` implements them with `@langfuse/tracing` on an isolated OpenTelemetry provider (nothing global), in the `eval` environment. Each trace has the extraction generation, the repair generation when repair runs, and the dataset, document id, model, prompt version, exact match and rule verdict as metadata. Without `LANGFUSE_BASE_URL` the runner behaves exactly as before, and the JSON report remains the reproducible record.
6. **Document bytes are never sent.** Eval traces name the file and its media type, never its content. Workflow traces contain the invoice text the run received, which is why Langfuse is self-hosted: traces of real invoices stay on this machine, and Langfuse Cloud is not used for them.
7. **The report is computed locally.** `pnpm obs:report` reads traces and generations back through the Langfuse public API and computes counts, total cost and nearest-rank p50/p95 latency per model, per prompt version and per branch. The aggregation is a pure, tested function. Ingestion is asynchronous, so the command retries until the trace count stops changing and prints the count it saw.

## Consequences
- Every traced document shows where its time and money went, and a `needs_review` trace shows the question next to the generation that caused it ([docs/observability.md](../observability.md)).
- Tracing adds one step to the local setup (`pnpm langfuse:up` and `LANGFUSE_BASE_URL` in `.env`) and nothing to CI.
- The Langfuse stack uses about 1.7 GiB idle (measured in docs/observability.md).
- Prompt management, rule results as scores and annotation queues are later changes; this ADR only covers tracing and the report.
