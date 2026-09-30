# Design

## Context

- **Pausing.** The workflow pauses in `human-review` with `{ documentId, issues, question }` and resumes with `{ approved, reviewer }` (`apps/api/src/workflows/process-document.ts`). Mastra resumes by step position (ADR-0010, decision 6).
- **Annotation queues.** Langfuse v4 has them. Verified facts:
  - they need at least one score config;
  - adding the same object twice creates two items;
  - items have status `PENDING` or `COMPLETED`;
  - queues cannot be deleted through the API.
- **Corrected output.** Verified facts:
  - it is stored as a score with `dataType: CORRECTION`, name `output` and a string value;
  - it is readable at `GET /api/public/v3/scores?dataType=CORRECTION&fields=details,subject,annotation`;
  - the API does not enforce one correction per object.
- **Part 1** (`add-prompt-registry-and-rule-scores`) gives generations their input (source text) and output (canonical invoice), plus rule scores. Without it a reviewer has nothing to correct.
- The database does not store the source text. The trace does.

## Goals / Non-Goals

**Goals:**
- One place to review (the Langfuse UI) and one command (`review:sync`) that makes reviews take effect.
- Sync and export are safe to re-run.

**Non-Goals:**
- Live webhooks from Langfuse. Sync is pull-based and run on demand.

## Decisions

1. **Queue the generation, not the trace.** The correction attaches to the object whose output is the invoice. The enqueue happens in `human-review` on first suspend. Our own marker, a trace metadata key `queued: true`, plus a list-items check guard against duplicates.
   - The queue and config are created lazily, using list-then-find by name.
2. **Resume data.** `ReviewDecisionSchema` gains `invoice?: Invoice`.
   - On approve with an invoice, `human-review` passes it forward. Persist saves it, re-verifies it, and records the issues as a warning only; the golden invoice is "as printed".
   - The field is optional, so snapshots and terminal reviews are unchanged.
3. **Mapping an item to its run.** A queue item points to an observation. The trace metadata holds `documentId` and `runId`: `runId` is added at run start, and the research saw it already present. Sync calls `reviewDocument(runId, decision)`.
   - It skips when the document status is no longer `needs_review`. This covers the idempotent re-run and the case where the CLI resolved it first.
4. **Picking the correction.** Among the CORRECTION scores on the observation, prefer `source=ANNOTATION`, then the latest timestamp. The value is parsed as JSON and validated with `InvoiceSchema`.
   - Money in the corrected JSON is integer cents, as the reviewer sees it in the output. The reviewer guide says so, with an example.
5. **Verdict precedence.**
   - `unusable` rejects.
   - `corrected` requires a valid correction, and otherwise the item is reported and not resumed.
   - `correct` approves the extraction.
   - A completed item with no verdict is reported and skipped.
   - Items are not moved back to pending. The report lists what needs attention.
6. **Golden export.** Built from the same completed items and their data, reading the source text from the generation input. It upserts by document id into `data/golden/golden.jsonl`, sorted by document id so diffs are stable.
   - The record is `{ id, documentId, verdict, invoice, text, traceId, observationId, promptVersion, reviewedAt, source: "langfuse-review" }`.
7. **Fixture generator.** `packages/synth` gains `renderInvoiceText(invoice)`, a plain-text layout like `fixtures/text`, and `injectError(invoice, kind, random)`.
   - The printed values change; the manifest holds the true values.
   - The kinds rotate so every one appears. Output is seeded and deterministic.
   - Files are written to `data/review-fixtures/` with `manifest.jsonl`.
8. **Security of the UI path.** Everything stays local (ADR-0011). Sync uses the local API keys already configured.

## Risks / Trade-offs

- **The reviewer edits cents** (`11285`), not euros, in the JSON. → Mitigation: the guide gives an example, and schema validation rejects floats.
- **Two review paths** (CLI and Langfuse) can race. → Mitigation: sync skips runs that are no longer paused, and the CLI remains authoritative when used first.
- **Corrected output UX unknowns:** whether the editor pre-fills the original JSON. → Mitigation: checked in the UI during implementation; the guide documents what is actually seen.
- **Suspended runs from before this change** lack `runId` metadata. → Mitigation: sync falls back to looking up the paused run by `documentId` in the Mastra storage, or reports it.

## Migration Plan

- Additive. `ReviewDecisionSchema` gains an optional field, and existing suspended runs resume as before.
- Rollback means reverting the PR. The queue and config stay in Langfuse, which is harmless.

## Open Questions

- None.
