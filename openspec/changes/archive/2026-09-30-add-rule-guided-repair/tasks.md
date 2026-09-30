# Tasks

## 1. Structured rule details

- [x] 1.1 RED: add tests in `packages/rules` asserting `details` for each error rule (`lines-sum`, `vat-amount`, `total` with the 90.00 / 18.90 / 6.05 / 112.85 example, `vat-rate`, `tax-ids`, `issue-date`), and that existing messages, severities and paths are unchanged. Verify that the new tests fail.
- [x] 1.2 GREEN: add the optional `details` to `Violation` and fill it in each error rule. Carry `details` through `IssueSchema` in the workflow. Verify with `pnpm test packages/rules apps/api`.

## 2. Repair in `@invariant/extractor`

- [x] 2.1 RED: add `repair.test.ts` with a mock model. Verify that the tests fail. Cases:
  - a text source → one call whose user message has the repair instructions, the error messages and the original text, and nothing from the previous answer;
  - a document source → a `file` part with the same bytes and media type;
  - the result has prompt version `repair-v1`;
  - calling it with no errors throws, because it is a programming error.
- [x] 2.2 GREEN: add `prompts/repair-v1.ts` and `repairInvoice(source, errors, model)` on top of `extractWithModel`, and export them. Verify with `pnpm test packages/extractor`.

## 3. Workflow repair step and concrete question

- [x] 3.1 RED: add `question.test.ts` for the Spanish question per error rule, covering the `total` example exactly, `lines-sum` with a `line-amount` warning (3 × 12,00 € vs 42,00 €) and the customer tax id. Verify that the tests fail.
- [x] 3.2 GREEN: implement `buildReviewQuestion(issues)` in `apps/api/src/review/question.ts`. Verify with `pnpm test apps/api`.
- [x] 3.3 RED: extend `process-document.test.ts` with scripted mock models (Postgres integration, as today). Verify that the new tests fail. Cases:
  - no errors → one model call, accepted, not repaired;
  - wrong tax id, then fixed → two calls, accepted by rules, repaired, prompt version `repair-v1` persisted;
  - still wrong after repair → two calls, `needs_review` with the concrete question and the issues;
  - repair worse → the original is kept.
- [x] 3.4 GREEN: add the `repair` step (source via `getInitData()`), selection, `repaired` in the outcome, the question in the suspend payload, and "repaired" in `printResult`. Verify with `pnpm test apps/api`.
- [x] 3.5 Write `docs/adr/0010-rule-guided-repair.md`: what goes in the repair prompt and why, the selection rule, errors only, questions in Spanish, and a single attempt with a clean context (with the paper reference). Link it from `docs/architecture.md`. Verify that the links resolve.

## 4. Measure repair

- [x] 4.1 RED/GREEN: add a `--repair` option to the eval runner with a unit test using a fake extractor and repairer: before and after summaries, repairs attempted and used. Verify with `pnpm test packages/evals`.
- [x] 4.2 Run `pnpm eval:extract --dataset data/synth --format jpg --limit 20 --repair` with gpt-5-mini, and `pnpm extract:text fixtures/text/invoice-002-wrong-total.txt`. Record in `docs/evals.md` the before/after table and the concrete question the fixture produces. Verify that the numbers match the report.
- [x] 4.3 Integration: run `pnpm lint && pnpm typecheck && pnpm test && pnpm py:check`, open the PR and confirm that CI is green.
