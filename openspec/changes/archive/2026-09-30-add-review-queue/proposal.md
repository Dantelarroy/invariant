# Proposal: add-review-queue

## Why

A document that ends in `needs_review` still has to be approved or rejected from a terminal (`pnpm review <runId> approve|reject`). That review cannot correct a value, and it teaches the system nothing. Day 12, part 2 makes review a real annotation loop:
- the reviewer works in Langfuse;
- a correction resolves the paused run with the corrected invoice;
- every reviewed document becomes a golden record for evals and, later, training.

## What Changes

- **Review queue.** When a run pauses for review with tracing on, the chosen extraction generation is added once to a Langfuse annotation queue, `invariant-review`.
  - The queue has a `verdict` score config: `correct`, `corrected` or `unusable`.
  - The reviewer sees the source text, the extracted invoice, the rule scores and the review question.
  - The reviewer sets the verdict and, when needed, edits the invoice as a corrected output.
- **Review sync closes the loop.** `pnpm review:sync` reads completed queue items and resumes each paused run:
  - `correct`: approve as extracted;
  - `corrected`: approve with the corrected invoice, validated against the invoice schema;
  - `unusable`: reject.

  An item that was already resolved, or whose correction is not a valid invoice, is reported and skipped. The terminal review keeps working.
- **The resume accepts a corrected invoice.** When the reviewer's decision carries a corrected invoice, the workflow persists that invoice, re-verified for the record, instead of the extraction.
- **Golden set.** `pnpm golden:export` writes one record per reviewed document to `data/golden/golden.jsonl` (git-ignored).
  - Each record holds the id, the invoice as the reviewer confirmed it, the source text, the verdict, and the document, trace and prompt ids.
  - Records are upserted by document id.
  - `unusable` documents are left out.
- **Review fixtures.** `pnpm synth:review --count 12` writes text invoices rendered from synthetic invoices, each with one realistic printed error (a wrong total, wrong VAT, an invalid tax id or a line that does not add up), plus a manifest of the injected error. Processing them fills the queue (about 0.05 USD with gpt-5-mini).

## Non-goals

- Document (PDF/image) input in the workflow.
- Assigning reviewers, SLAs or several reviewers per document.
- Training on the golden set (day 16+). The export only produces the file.
- Deleting queues or score configs (the Langfuse API cannot).

## Capabilities

### New Capabilities
- `review-queue`:
  - queueing paused documents in Langfuse;
  - resolving runs from completed reviews, including corrected invoices;
  - exporting the golden set;
  - generating review fixtures.

### Modified Capabilities
- None. Terminal review keeps its behavior; the corrected-invoice path is new and covered by `review-queue`.

## Impact

- **Code:**
  - `packages/observability`: queue and score-config setup, enqueue, read completed items and corrections.
  - `apps/api`: enqueue on suspend, an optional corrected invoice in `ReviewDecisionSchema` and persist, and the `review:sync` and `golden:export` CLIs.
  - `packages/synth`: the review fixture generator.
- **Data:** `data/golden/golden.jsonl` and `data/review-fixtures/`, both git-ignored.
- **Depends on** `add-prompt-registry-and-rule-scores`, because the generation needs its input and output for the reviewer to correct.
- **ADRs:** relies on ADR-0003, ADR-0010, ADR-0011 and ADR-0012. Adds ADR-0013, on why Langfuse is the review surface, why a correction resolves the run, and why the golden set is "as printed" (it does not need to pass the rules).
- **Done when:** 10 documents are reviewed in the queue, `review:sync` resolves them, and they appear in `golden.jsonl`.
