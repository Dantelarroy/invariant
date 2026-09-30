# Design

## Context

- `Violation` is `{ ruleId, severity, message, path? }` (`packages/rules/src/rules.ts`). The numbers only exist inside English prose messages.
- The workflow (`apps/api/src/workflows/process-document.ts`) runs ingest → extract → verify → human-review → persist.
  - `ExtractedSchema` carries `documentId`, `invoice` and `promptVersion`, but not the source text.
  - The human-review question is a fixed string.
  - Suspend and resume go through mastra snapshots in Postgres (ADR-0003).
- `extractWithModel({ instructions?, messages }, model, promptVersion)` (`packages/extractor/src/extract-with-model.ts`) is the shared extraction core.
- `MockLanguageModelV4` accepts an array of `doGenerate` results, answered in order, and records `doGenerateCalls`. That lets tests script "wrong, then fixed".
- Research note (arXiv 2605.08563): keeping a failed attempt in context makes the retry fail far more often, so we clear it before retrying. Sending only the violated rules is our design choice; the paper does not test it.

## Goals / Non-Goals

**Goals:**
- Keep rules pure and their messages unchanged. `details` is additive.
- Keep repair a pure function of `(source, errors, model)` so the workflow and the eval runner share it.
- Make the question builder a pure function of `(errors, warnings)` with snapshot-style tests.

**Non-Goals:**
- Generic templating or i18n. There is one Spanish question builder, with one case per error rule.

## Decisions

1. **`details` as a typed, per-rule record.**
   - `Violation` gains an optional `details?: Record<string, number | string>`.
   - Each rule fills its own keys, e.g. `total: { taxBaseCents, vatAmountCents, withholdingCents, expectedCents, printedCents }`.
   - *Alternative:* a discriminated union per rule id. It is stronger, but it would ripple through every consumer. The question builder narrows by `ruleId` and reads known keys, with a test per rule.
2. **Repair input.**
   - `repairInvoice(source, errors, model)`, where `source` is `{ text }` or `{ document }`.
   - It builds one user message: the repair instructions, the error messages as a bullet list, then the original text or document part.
   - Messages mention the values the model read ("Total is 112,85 €…"), which re-exposes part of the failed attempt. We accept that: the model needs to know what to re-check, and the full previous JSON and conversation are still excluded.
   - The prompt (`repair-v1`) says: re-read the document; correct only what the document shows; if the document itself is inconsistent, copy it as printed.
   - *Alternative:* a blind retry without the rule messages. It is cheaper to write, but it gives the model no target.
3. **Selection: "no errors wins, otherwise fewer errors, otherwise the original."** A tie keeps the original, so a repair never changes numbers without evidence of improvement.
4. **Workflow shape.**
   - A new `repair` step between `verify` and `human-review`, with input and output `VerifiedSchema` plus `repaired: boolean`.
   - The source text is read with `getInitData()` rather than threaded through every schema, which keeps snapshots unchanged.
   - Outcome `accepted` gains `repaired: boolean`, and `printResult` shows "repaired" when true.
5. **Question builder** (`apps/api/src/review/question.ts`).
   - It takes `(issues)`, picks the first error in `RULES` order and renders one Spanish sentence per rule id with `formatMoney`, then appends a sentence per `line-amount` warning.
   - Spanish, because the reviewer reads Spanish invoices; formats are data (AGENTS.md). Code, tests and issue messages stay in English.
6. **Evals.**
   - `eval:extract --repair` wraps the extractor: extract → verify → maybe repair → select.
   - It scores the extraction before repair and the chosen one after, and reports both summaries plus `repairsAttempted` and `repairsUsed`.
   - Existing reports without repair keep their shape.

## Risks / Trade-offs

- **The repair confirms a wrong value** (the model repeats itself). → Mitigation: the "fewer errors" selection, and a person still reviews anything with errors.
- **The repair "fixes" a genuinely inconsistent document** by recomputing a total. → Mitigation: the prompt says to copy what is printed. The `invoice-002-wrong-total` fixture must still end in review, which is covered by an integration test with a real model where available.
- **The question picks the wrong root cause** when several errors appear (e.g. `lines-sum` and `total` together). → Mitigation: rule order puts `lines-sum` and `vat-amount` before `total`, and the full issue list stays in the request.
- **Cost:** at most one extra call, and only for documents with errors.

## Migration Plan

- The code change is additive. Existing workflow runs suspended before this change resume at `human-review` with their original question.
- The new `repair` step only affects new runs.
- Rollback means reverting the PR.

## Open Questions

- Whether repair should also switch to a larger model (the cascade). That is deferred to the cascade change and does not affect these specs.
