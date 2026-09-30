# ADR-0013: Langfuse as the review surface, corrections resolve the run, and an "as printed" golden set

- **Status:** Accepted
- **Date:** 2026-09-30

## Context
A document that fails an error rule, even after one repair (ADR-0010), pauses in `human-review` (ADR-0003) until someone runs `pnpm review <runId> approve|reject`. That review happens in a terminal, cannot correct a value, and teaches the system nothing: nothing records what the right invoice was.

Since ADR-0011 and ADR-0012, every paused run has a trace in the local Langfuse, whose extraction generation holds the source text as input, the invoice as output and the rule results as scores. Langfuse v4 has annotation queues. Verified on 4.47.0:
- a queue needs at least one score config, and queues and configs cannot be deleted through the API;
- adding the same object twice creates two items, and the API does not check that the object exists;
- items are `PENDING` or `COMPLETED`;
- a "corrected output" is a score with `dataType: CORRECTION`, name `output` and a string value, readable through `GET /api/public/v3/scores`; nothing keeps it to one per object.

We must decide where a person reviews, how a review takes effect on the paused run, and what a reviewed document becomes.

## Decision
1. **Langfuse is the review surface.** A paused run adds its chosen generation (the extraction, or the repair when it was chosen) to the annotation queue `invariant-review`, once, on first suspend.
   - The queue has one categorical score config, `verdict`: `correct`, `corrected` or `unusable`.
   - The reviewer sees the source text, the extracted invoice, the rule scores and, in the trace, the review question. They set the verdict and, when needed, edit the corrected output. How is in [docs/review.md](../review.md).
   - The generation is queued, not the trace, because the correction belongs to the object whose output is the invoice.
   - The queue and the config are looked up by name, and created only when missing, once per process. Duplicates are avoided by listing the queue's items first; the trace also gets `queued: true`.
   - The enqueue is fire-and-forget, like the scores: tracing off means nothing is queued, and a Langfuse failure is logged and never stops the run from pausing. `close()` waits for it.
   - The terminal review keeps working. Everything stays local (ADR-0011).
2. **A completed review resolves the run, through `pnpm review:sync`.** Sync is pulled on demand; there are no webhooks.
   - Each queued generation carries the workflow `runId` and `documentId` in its metadata, which map an item back to its paused run.
   - `unusable` rejects. `correct` approves the extraction. `corrected` approves the corrected invoice, which must parse as JSON and pass `InvoiceSchema` (integer cents); otherwise the item is reported and the run stays paused. A completed item without a verdict is reported.
   - A run whose document is no longer `needs_review` is skipped: re-running sync changes nothing, and a terminal review that came first wins.
   - The planning is a pure, tested function. Items are never moved back to pending; the report lists what needs attention.
   - Among several corrections on one generation, the reviewer's annotation wins over an API score, then the latest.
3. **The resume can carry a corrected invoice.** `ReviewDecisionSchema` gains an optional `invoice`. On approval, persist stores it instead of the extraction, with the reviewer, and the outcome says `corrected: true`; on rejection it is ignored. The field is optional because mastra resumes by step position (ADR-0010, decision 6) and old snapshots and terminal reviews must resume unchanged. The stored prompt version stays the one of the extraction the reviewer corrected.
4. **The golden set is "as printed".** `pnpm golden:export` upserts one record per reviewed document into `data/golden/golden.jsonl` (git-ignored): the invoice the reviewer confirmed (the correction, or the extraction when `correct`), the source text, the verdict, and the document, trace, observation and prompt ids, with the review time.
   - A document whose printed total is wrong keeps that total: the golden invoice describes the document, not what it should have said, so it is not required to pass the business rules. Persist re-verifies a corrected invoice only to record the result (trace metadata `correctedRulesValid`, and a log line).
   - `unusable` documents are left out, and an existing record is dropped when its document is later marked `unusable`. Records are sorted by document id so diffs are stable. The merge is pure and idempotent.
5. **Review fixtures with known errors.** `pnpm synth:review` renders seeded synthetic invoices (ADR-0006) as plain text, each with one printed error (a wrong total, a wrong VAT amount, an invalid supplier tax id, or a line amount that does not match), rotating so every kind appears, and a manifest with the true values. Same seed and count, same files.

## Consequences
- Review, correction and the training data it produces share one place and one command. The golden set grows with every reviewed document.
- The reviewer edits JSON in integer cents (`10285`, not `102,85`); schema validation rejects floats and sync reports them. The guide gives an example.
- Two review paths (terminal and Langfuse) can race; sync skips whatever is already resolved.
- The queue and its config stay in Langfuse after a rollback; they are harmless.
- Documents paused before this change are not in the queue; they are still reviewed from the terminal.
- Training on the golden set is a later change; the export only writes the file.
