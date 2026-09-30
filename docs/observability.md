# Observability

Every processed or evaluated document can leave one trace in a local, self-hosted [Langfuse](https://langfuse.com) v4: its steps, model calls, tokens, cost and latency. Decisions are in [ADR-0011](adr/0011-observability.md).

## Start and stop

```sh
pnpm langfuse:up     # starts infra/langfuse and waits until every service is healthy
pnpm langfuse:down   # stops it; traces stay in the Docker volumes
```

- The UI is at <http://127.0.0.1:3000>. Log in as `dev@invariant.local` / `invariant_local_only`.
- The first start takes 2–3 minutes (database migrations). It creates the organization, the `invariant` project, the user and the API keys (`pk-lf-invariant-local-only` / `sk-lf-invariant-local-only`) without any click.
- Only the web app (`127.0.0.1:3000`) and MinIO (`127.0.0.1:9090`, for presigned media uploads) are published, both on localhost only.
- Do not run it next to the ERP stack (`pnpm erp:up`): both do not fit in the 5 GB WSL limit. Stop Langfuse when you are not using it.
- `docker compose -f infra/langfuse/docker-compose.yml down -v` deletes every trace.

## Memory

Idle, measured with `docker stats --no-stream` on 2026-09-30, with the Langfuse stack, `invariant-postgres` and `invariant-validator` up and the ERP stack down (WSL limit: 4.80 GiB usable):

| Container | Memory | Limit |
|---|---:|---:|
| langfuse-web | 947.6 MiB | 1.5 GiB |
| langfuse-worker | 468.7 MiB | 1 GiB |
| clickhouse | 207.3 MiB | 1.25 GiB |
| minio | 78.1 MiB | 256 MiB |
| postgres (Langfuse) | 57.8 MiB | 256 MiB |
| redis | 18.4 MiB | 128 MiB |
| invariant-validator | 292.2 MiB | none |
| invariant-postgres | 59.0 MiB | none |
| **Total** | **2.08 GiB** | |

- The web app runs out of a 512 MB V8 heap during its first start, so it gets 1024 MB; the worker keeps 512 MB.
- ClickHouse is capped at 1 GB of server memory, with a small mark cache and no system log tables (`infra/langfuse/clickhouse/low-memory.xml`).

## Turn tracing on

Tracing is off unless `LANGFUSE_BASE_URL` is set. Add it to `.env`, or pass it for one command:

```sh
LANGFUSE_BASE_URL=http://127.0.0.1:3000 pnpm extract:text fixtures/text/invoice-001.txt
LANGFUSE_BASE_URL=http://127.0.0.1:3000 pnpm eval:extract --dataset data/synth-erp --limit 50
```

- The keys default to the local-only ones; set `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` to use others.
- Workflow runs (`extract:text`, `review`) go to the `pipeline` environment, eval runs to `eval`.
- A workflow trace has a span per step, a generation per model call (named after the prompt version, with model, tokens, cost and latency), the document id, model and prompt version as metadata, and a branch as metadata and tag: `accepted`, `repaired`, `needs_review`, `failed`, `rejected` or `duplicate`.
- A resumed review is a nested run inside the same trace, with its own branch. The report takes the branch of the last run.
- An eval trace is named after the document id. Its input is the file name and media type, never the document. Its metadata holds the dataset, model, prompt version, exact match and rule verdict.
- If Langfuse is down, runs behave the same; the command only waits a few seconds at exit while the export gives up.

## Cost and latency report

```sh
LANGFUSE_BASE_URL=http://127.0.0.1:3000 pnpm obs:report --since 2026-09-30T07:25:15Z --env eval
```

- It reads observations through `GET /api/public/v2/observations` (the v1 traces endpoint is disabled on Langfuse v4) and rebuilds the traces locally.
- It prints the trace count, the total cost Langfuse computed from model and tokens, and nearest-rank p50/p95 trace latency per model, per prompt version and per branch.
- Ingestion is asynchronous, so it reads until the trace count stops changing and prints how many reads it took.
- `--since` defaults to 24 hours ago; `--env` defaults to `eval`.

### Day 11 run (2026-09-30)

50 FacturaScripts PDFs (`data/synth-erp`, first 50 labels), gpt-5-mini, prompt `extract-document-v2`, tracing on:

```bash
LANGFUSE_BASE_URL=http://127.0.0.1:3000 pnpm eval:extract --dataset data/synth-erp --limit 50
LANGFUSE_BASE_URL=http://127.0.0.1:3000 pnpm obs:report --env eval --since 2026-09-30T11:42:03Z
```

```text
environment eval · since 2026-09-30T11:42:03.000Z · 2 reads
traces        50
model calls   50
total cost    $0.1585

model                  traces  calls     cost       p50       p95
gpt-5-mini-2025-08-07      50     50  $0.1585  10891 ms  14644 ms

prompt version       traces  calls     cost       p50       p95
extract-document-v2      50     50  $0.1585  10891 ms  14644 ms

branch  traces  calls     cost       p50       p95
(none)      50     50  $0.1585  10891 ms  14644 ms
```

- **Accuracy:** all 50 were exact matches with a 100 % rule pass. Eval report: `synth-erp-gpt-5-mini-20260930T114242.json`.
- **Cost:** about $0.0032 per document; 78,686 input and 69,416 output tokens.
- **Branch:** eval traces have no branch, because branches belong to workflow runs.
- **Memory:** the first two attempts were stopped by host memory pressure on this 8 GB laptop (WSL at 5 GB, under 1 GB left for Windows). The run completed with the EN16931 validator stopped and no other heavy apps open. Run Langfuse on demand and stop it (`pnpm langfuse:down`) between sessions.

Both text fixtures run through the workflow with tracing on (copies with added newlines, since the originals are already in the database; `pnpm obs:report --env pipeline --since 2026-09-30T11:52:57Z`):

```text
environment pipeline · since 2026-09-30T11:52:57.000Z · 2 reads
traces        2
model calls   3
total cost    $0.0067

model                  traces  calls     cost      p50       p95
gpt-5-mini-2025-08-07       2      3  $0.0067  9099 ms  16324 ms

prompt version   traces  calls     cost       p50       p95
extract-text-v1       2      2  $0.0045   9099 ms  16324 ms
repair-v1             1      1  $0.0022  16324 ms  16324 ms

branch        traces  calls     cost       p50       p95
accepted           1      1  $0.0025   9099 ms   9099 ms
needs_review       1      2  $0.0041  16324 ms  16324 ms
```

The accepted invoice made one model call. The wrong-total invoice made two (extraction and one repair) and ended in `needs_review`, so a review costs about 1.6× an accepted document here.

## From a `needs_review` trace to its cause

This walkthrough follows the `invoice-002-wrong-total` fixture, run with tracing on. It was checked through the public API, which returns the same objects the UI shows.

1. **Find the trace.** In *Tracing*, filter environment `pipeline` and tag `needs_review`. The trace `process-document` has metadata `branch: needs_review`, the `documentId`, `model: gpt-5-mini`, `promptVersion: extract-text-v1` and the file name.
2. **Read the steps.** The tree shows `workflow_step ingest → extract → verify → repair → human-review`. `repair` took 64 s, most of the 72 s run; `extract` took 8 s.
3. **Read the question.** The output of `workflow_step human-review` is the review request: the `total` rule failed (`printedCents: 11285`, `expectedCents: 10285`) and the question is *"El total impreso es 112,85 € pero base + IVA − retención da 102,85 €. ¿El total del documento es 112,85 €?"*.
4. **Check the model calls.** Under `extract` and `repair` are the generations with the model the provider answered with (`gpt-5-mini-2025-08-07`), tokens and cost. The repair did not remove the error: the invoice itself prints a wrong total, and the repair prompt copies what is printed (ADR-0010).
5. **See the decision.** After `pnpm review <run-id> approve`, the same trace has a nested `process-document` run with `human-review → persist` and `branch: accepted`.

This trace was recorded before generations were exported with their model and tokens, so in it they show as plain spans named `model_generation gpt-5-mini-2025-08-07` without cost. Traces recorded now show a generation named `extract-text-v1` or `repair-v1` with model, tokens and cost.
