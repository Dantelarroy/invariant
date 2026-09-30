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
