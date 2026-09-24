# ADR-0003: Durable human review with mastra snapshots in Postgres

- **Status:** Accepted
- **Date:** 2026-09-24

## Context
When extracted numbers do not add up, the pipeline must ask a person instead of guessing. A person may answer minutes or days later, after the process that started the run has exited or been redeployed. The paused state (the extracted invoice, the issues found, which step is waiting) must therefore survive restarts.

## Decision
- The `human-review` step calls mastra's `suspend()` with the issues and a concrete question; `resume()` continues the same run with the reviewer's decision.
- Mastra stores run snapshots with `@mastra/pg` in the **same Postgres**, in a separate `mastra` schema, so no extra infrastructure is needed and its tables never mix with the ledger's.
- The ledger only receives an invoice after the checks pass or a reviewer approves it. A rejected document can be submitted again.
- Early exits (duplicate content, extraction failure) use `bail()` and end the run with a typed outcome instead of an exception.

## Consequences
- Resuming works from any process by run id (tested with a fresh Mastra instance).
- Mastra manages its own tables in the `mastra` schema; they are not part of our Drizzle migrations.
- `@mastra/pg` pulls in the `pg` driver, which gives drizzle-orm a second peer variant. Only `@invariant/db` imports drizzle, so the variants never meet in one type.
