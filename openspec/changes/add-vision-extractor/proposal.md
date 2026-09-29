# Proposal: add-vision-extractor

## Why

Invariant can only read invoices that are already plain text. Real invoices arrive as PDFs, scans and photos, so the extractor has to read the document itself. We also need a number, not a feeling, for how well it reads. With 360 labeled invoices on disk (300 printed by FacturaScripts, 60 from our own templates) we can now measure extraction per field before building repair, UBL or training on top of it.

## What Changes

- **Document extraction:** `@invariant/extractor` gains `extractInvoiceFromDocument(document, model)`. It sends a PDF or an image (PNG, JPEG, WebP) to a vision-capable model and returns the same validated `Invoice` and `ExtractionResult` as the text extractor. Its prompt lives in its own versioned file (`extract-document-v1`). Unsupported media types are rejected before any model call.
- **Extraction evals:** a new `@invariant/evals` package with a pure scorer, `scoreExtraction(expected, actual)`. It compares the extracted invoice with the label, field by field, and reports whether the extraction passes the business rules.
- **Eval runner:** a CLI, `pnpm eval:extract --dataset <dir> --model <id> --limit <n>`, runs the extractor over a labeled dataset (`labels.jsonl` plus files). It prints a summary with per-field accuracy, exact-match rate, rule pass rate, tokens and latency, and writes a JSON report to `data/evals/` (git-ignored).
- **Model comparison (day 9 goal):** run `gpt-5-mini` and `gpt-5` on the same 20 FacturaScripts invoices and record the result. This is the baseline for the small → frontier cascade. Both are OpenAI models. The model stays injected, so another provider can be added later without code changes.

## Non-goals

- Wiring document extraction into the mastra workflow and the `extract:*` CLI (next change).
- The cascade router itself (small model first, frontier model on failure).
- Annotating the real test set (`data/real`): it needs Dante's own invoices and a small annotation CLI, which is a separate change.
- A second model provider (Google, Anthropic) or local models.
- Langfuse tracing (day 11). The runner records tokens and latency locally for now.
- Multi-page invoices, line discounts and handwritten marks (ADR-0006 limits still apply).

## Capabilities

### New Capabilities
- `document-extraction`: extracting a validated invoice from a PDF or image with a vision-capable model.
- `extraction-evals`: scoring extractions against labels, and running a model over a labeled dataset to produce a reproducible report.

### Modified Capabilities
- None. The text extractor keeps its behavior.

## Impact

- **Code:**
  - `packages/extractor`: new function, new prompt file, tests with a mock model.
  - New `packages/evals`: scorer, dataset loader, runner CLI.
  - Root `package.json`: new `eval:extract` script.
- **Dependencies:** none new. The AI SDK (`ai` v7) already supports file and image parts, and `@ai-sdk/openai` is already in `apps/api`. The evals CLI will depend on it too.
- **Data:** reads `data/synth-erp` and `data/synth`; writes `data/evals/`. Everything under `data/` stays git-ignored.
- **Cost:** 20 invoices × 2 models, at a few cents per document at most, is well within the monthly budget.
- **ADRs:**
  - Relies on ADR-0002 (extraction is a fixed workflow), ADR-0005 (rules as scored checks), ADR-0006 and ADR-0007 (synthetic and ERP data).
  - Adds ADR-0008 on how extractions are scored.
