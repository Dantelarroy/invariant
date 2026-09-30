# Proposal: add-langfuse-tracing

## Why

Today a failed or slow document leaves no trail. We see the final outcome and, in evals, a JSON report, but not which step took the time, which model call cost what, or why a run ended in review. Production AI systems are debugged and improved from traces (haddock's own stack uses Langfuse). Day 11 makes every document leave one trace with its steps, model calls, tokens, cost and latency, and turns those traces into a cost and latency report.

## What Changes

- **Self-hosted Langfuse v4** in its own Docker stack (`infra/langfuse`): web, worker, Postgres, ClickHouse, Redis and MinIO.
  - Everything is bound to `127.0.0.1` with memory caps sized for an 8 GB laptop.
  - Setup is headless: organization, project, user and API keys are created on first start with local-only credentials, like the other local stacks.
  - `pnpm langfuse:up` / `langfuse:down` start and stop it on demand.
- **New `@invariant/observability` package:**
  - builds the Mastra observability config with the Langfuse exporter (pointed at the local server);
  - records model-call spans (generations) with model, prompt version, input/output tokens and latency;
  - tags each document trace with its branch;
  - traces the eval runner, which does not run through Mastra.
- **Workflow traces:** one trace per document run, with a span per step (ingest, extract, verify, repair, human-review, persist), a generation per model call, and metadata such as document id, model and prompt version. Each trace gets a branch: `accepted`, `repaired`, `needs_review`, `failed`, `rejected` or `duplicate`.
- **Eval traces:** `eval:extract` sends one trace per document to the same Langfuse, in the `eval` environment, with the extraction and optional repair generations and the score as metadata. Document bytes are never sent.
- **Report:** `pnpm obs:report` reads the traces back and prints document count, total cost, and p50/p95 latency per model, per prompt version and per branch.
- **Opt-in:** tracing is on only when `LANGFUSE_BASE_URL` is set. Tests and CI stay offline and unchanged.

## Non-goals

- Prompt management in Langfuse, rule results as scores, annotation queues and the golden set (day 12).
- Langfuse Cloud, alerts, or production deployment.
- Wiring document (PDF/image) input into the workflow. The 50-document trace run uses the eval runner on FacturaScripts PDFs.
- Replacing the JSON eval reports. They remain the reproducible record.
- Upgrading `@mastra/core`.

## Capabilities

### New Capabilities
- `observability`: tracing workflow runs and eval runs to a local Langfuse, and reporting cost and latency from those traces.

### Modified Capabilities
- None. Extraction, repair and eval behavior are unchanged; tracing only observes them.

## Impact

- **Code:**
  - new `packages/observability`;
  - `apps/api` (Mastra config, run metadata, generation spans in the extract and repair steps, branch tagging, flush before the CLI exits);
  - `packages/evals` (optional tracer);
  - `packages/extractor` (return the response model id and latency with the result; no behavior change).
- **Dependencies (pinned to match `@mastra/core` 1.69.0):**
  - `@mastra/observability` 1.18.0 and `@mastra/langfuse` 1.5.9;
  - `@langfuse/tracing` and `@langfuse/otel` 5.11.1;
  - the OpenTelemetry peers.
- **Infra:**
  - `infra/langfuse/docker-compose.yml`, pinned to Langfuse 4.47.0, ClickHouse 25.12, Redis 7, Postgres 17 and MinIO;
  - root scripts `langfuse:up` / `langfuse:down`.
- **Machine:** WSL memory raised from 3 GB to 5 GB (done, approved). Langfuse and the FacturaScripts stack are not meant to run at the same time.
- **ADRs:** relies on ADR-0002 and ADR-0003. Adds ADR-0011 on observability: self-hosted, opt-in, what a trace contains, and why document bytes are excluded.
- **Author action:** add `LANGFUSE_BASE_URL=http://127.0.0.1:3000` to `.env` to turn tracing on locally. Agents cannot edit env files.
