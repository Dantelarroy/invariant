# Tasks

## 1. Document extraction in `@invariant/extractor`

- [x] 1.1 RED: add `extract-from-document.test.ts` with a mock model. Cover: a PDF returns a schema-valid invoice with prompt version `extract-document-v1` and token usage; a JPEG is sent as a `file` part with media type `image/jpeg`; `text/html` and zero bytes throw `UnsupportedDocumentError` without calling the model; non-integer cents from the model fail validation; well-formed but inconsistent output is returned unchanged. Verify that the new tests fail.
- [x] 1.2 GREEN: add `prompts/extract-document-v1.ts`, the shared extraction core and `extractInvoiceFromDocument`, and export them with `Document` and `UnsupportedDocumentError` from the package index. Verify with `pnpm test packages/extractor`, where the text extractor tests still pass unchanged.
- [x] 1.3 REFACTOR: make `extractInvoiceFromText` use the shared core, with no behavior change. Verify with `pnpm lint && pnpm typecheck && pnpm test packages/extractor`.

## 2. Scoring in the new `@invariant/evals` package

- [x] 2.1 Scaffold `packages/evals` (package.json, tsconfig, index) following `packages/rules`, and add it to the workspace. Verify with `pnpm install` and `pnpm typecheck`.
- [x] 2.2 RED: add `score.test.ts` for every scenario in `specs/extraction-evals` "Field-level scoring" and "Rule verdict":
  - perfect match;
  - 1-cent total miss;
  - tax id `b-12345674` against `B12345674`;
  - withholding missing;
  - absent in both;
  - wrong but consistent extraction with rules passing.

  Verify that the tests fail.
- [x] 2.3 GREEN: implement `scoreExtraction` and `summarize`, which covers per-field accuracy, exact-match rate, rule pass rate, failures, tokens and median latency, and add `summarize` tests. Verify with `pnpm test packages/evals`.
- [x] 2.4 Write `docs/adr/0008-scoring-extractions.md`, covering exact cents, identifier normalization, lines scored by count for now, "absent in both" as a match, and why rule pass rate is reported next to accuracy. Verify that the ADR is linked from `docs/architecture.md`.

## 3. Dataset loader and eval runner

- [x] 3.1 RED/GREEN: add `loadDataset(dir, { format, limit })` with tests on a temporary directory. It keeps the file order stable, applies the limit, and when a label names a missing file it throws before anything runs, naming that file. Verify with `pnpm test packages/evals`.
- [x] 3.2 Add the CLI `src/cli/eval-extract.ts` and the root script `eval:extract` (options `--dataset`, `--model`, `--limit` default 20, `--format` default pdf). It loads `.env` via `fileURLToPath`, extracts one document at a time, keeps going after a failure, prints the summary table and writes the report to `data/evals/`. Verify with `pnpm eval:extract --dataset data/synth-erp --model gpt-5-mini --limit 2`, which prints a summary and writes a report whose `meta` has dataset, model, prompt version, limit, format and start time.
- [x] 3.3 Document the command in `README.md` (Commands) and state that reports stay in the git-ignored `data/`. Verify that the documented command runs as written.

## 4. Day 9 baseline

- [x] 4.1 Run `gpt-5-mini` and `gpt-5` on the first 20 FacturaScripts invoices (`--format pdf`), and `gpt-5-mini` on 20 degraded JPEGs from `data/synth` (`--format jpg`). Verify that the three reports exist in `data/evals/`.
- [x] 4.2 Record the baseline in `docs/evals.md`: models, prompt version, per-field accuracy, exact-match rate, rule pass rate, tokens and latency, with the caveat that the ERP layout is not real-world accuracy. Verify that the numbers match the reports.
- [x] 4.3 Integration check: run `pnpm lint && pnpm typecheck && pnpm test && pnpm py:check`, then open the PR and confirm CI is green. (Local checks green on 2026-09-29; the PR and CI are left to the author.)
