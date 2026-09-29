# Design

## Context

- `@invariant/extractor` has one entry point, `extractInvoiceFromText(text, model)`. It calls the AI SDK `generateText` with `Output.object(ModelInvoiceSchema)` and converts the result with `toInvoice`. The model is injected, and tests use a mock. Business rules run later, in `@invariant/rules`.
- `ai` v7 accepts documents as a user-message `file` part (`{ type: "file", mediaType, data }`), for PDFs and images alike. The older `image` part is deprecated. `@ai-sdk/openai` sends PDFs as file inputs and images as image inputs, and the gpt-5 family accepts both.
- Labeled data on disk, all in the same `labels.jsonl` shape (`{ id, invoice, ... }`):
  - `data/synth-erp`: 300 PDFs printed by FacturaScripts;
  - `data/synth`: 30 × (PDF + degraded JPEG) from our templates.
- There is no evals package yet. `docs/architecture.md` reserves `@invariant/evals` for it.

## Goals / Non-Goals

**Goals:**
- Reuse the text extractor's output path, so text and documents produce the same contract and the same errors.
- Keep the scorer pure and fully unit-tested. Only the runner does I/O and calls models.
- Make a run cheap to repeat: deterministic order, a limit, and a report that records everything needed to compare runs.

**Non-Goals:**
- Page splitting, rasterizing PDFs to images, or any client-side OCR. The model reads the document.
- Retries, concurrency tuning or cost optimization in the runner. It runs documents one at a time.

## Decisions

1. **One extraction core, two entry points.**
   - The shared step becomes `extractWithModel(messages, model, promptVersion)`, which calls `generateText` with `Output.object` and then `toInvoice`.
   - `extractInvoiceFromText` builds a text prompt; `extractInvoiceFromDocument` builds a user message with an instruction text part and a `file` part.
   - *Alternative:* a single function with a union input. Rejected: two small, explicit functions read better and keep the text path untouched.
2. **Documents as `file` parts for every media type.** The media type goes through unchanged, and the provider picks image or file input. We avoid the deprecated `image` part and do not branch between PDF and image.
3. **Validation before the call.**
   - A `Document` is `{ bytes: Uint8Array; mediaType: string }`.
   - Unsupported media types and empty documents throw a typed `UnsupportedDocumentError` before any network call, which the mock-model test proves.
   - Media types are inferred from file extensions only in the runner, not in the extractor.
4. **Separate, versioned document prompt.**
   - `prompts/extract-document-v1.ts` exports its instructions and `EXTRACT_DOCUMENT_PROMPT_VERSION = "extract-document-v1"`.
   - It restates the text prompt's rules (cents, ISO dates, Spanish formats, no invention) and adds document-specific guidance: read printed totals rather than recomputing them, and ignore stamps and handwriting.
   - *Alternative:* reuse the text prompt. Rejected, because document reading has its own failure modes and must be versioned independently for evals.
5. **Scoring rules live in ADR-0008.**
   - Exact cents for amounts.
   - Identifiers compared after removing case, spaces, dots and hyphens.
   - Dates compared as ISO strings.
   - Lines scored by count only in this change. Per-line matching needs an alignment decision and is deferred.
   - "Absent in both" counts as a match.
   - Why exact cents: a 1-cent miss on a total is a real accounting error, and the rules already allow rounding tolerance where the law does.
6. **`@invariant/evals` package.**
   - `scoreExtraction(expected, actual)` returns per-field results, `exactMatch`, and the rule verdict from `verifyInvoice(actual, { today })`. `today` is fixed per run from the report start time, so runs can be reproduced.
   - `summarize(results)` aggregates the per-document results.
   - `loadDataset(dir)` reads `labels.jsonl` and checks that every file exists before anything runs.
   - The CLI (`src/cli/eval-extract.ts`) wires `@ai-sdk/openai`. It reuses the `process.loadEnvFile` + `fileURLToPath` pattern from `apps/api/src/cli/env.ts`, so it works on Windows.
7. **Label-to-file mapping.** A label's `id` maps to `<id>.pdf`. The runner accepts `--format pdf|jpg` (default `pdf`), so the degraded JPEGs in `data/synth` can be evaluated too.
8. **Report format.**
   - One JSON file, `data/evals/<dataset>-<model>-<YYYYMMDDTHHMMSS>.json`, with:
     - `meta`: dataset, model, prompt version, limit, format, start time;
     - `summary`;
     - `documents[]`: id, field results, rule verdict, tokens, latency, error.
   - The printed summary is a small aligned table.

## Risks / Trade-offs

- **The model reads PDFs differently from images.** OpenAI extracts PDF text and page images, so PDF accuracy may overstate photo accuracy. → Mitigation: `--format jpg` on `data/synth` measures degraded images separately, and both numbers are recorded.
- **FacturaScripts invoices share one layout.** → Mitigation: accuracy on them is reported as "ERP layout", not as real-world accuracy (ADR-0007). The real benchmark stays the only accuracy we publish.
- **Structured output limits.** Strict mode needs every field present, which is already solved by `ModelInvoiceSchema` with nullable fields. → No change.
- **Cost overrun on large runs.** → Mitigation: the runner defaults to limit 20, and the report records tokens so cost is visible.
- **Line count is a weak line metric.** → Mitigation: explicitly deferred, and noted in ADR-0008.

## Migration Plan

Additive only: new function, new package, new script. Nothing is migrated. Rollback means reverting the PR.

## Open Questions

- Per-line matching and alignment (description, quantity, unit price) can be added in a later change without changing these specs.
