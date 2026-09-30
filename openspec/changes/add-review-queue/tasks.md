# Tasks

## 1. Review fixtures

- [x] 1.1 RED/GREEN: `renderInvoiceText` and `injectError`, one error per invoice, covering all kinds, deterministic with a seed, and the manifest holding the true value. Add the `synth:review --count --seed` CLI. Verify with `pnpm test packages/synth`, and check that running the CLI twice gives identical files.

## 2. Resume with a corrected invoice

- [x] 2.1 RED/GREEN: `ReviewDecisionSchema` gains an optional `invoice`. Approving with it persists the corrected invoice and the reviewer; approving without it behaves as before; rejecting ignores it. Verify with `pnpm test apps/api` (Postgres integration).

## 3. Queue, sync and export

- [x] 3.1 RED/GREEN, with a fake `fetch`: `ensureReviewQueue` (lazy creation of the queue and the verdict config), `enqueueForReview` (no duplicates), `listCompletedReviews` (items joined with verdict and correction, correction choice per design 4). Verify with `pnpm test packages/observability`.
- [x] 3.2 Enqueue in `human-review` on first suspend when tracing is on, and add `runId` to the trace metadata. Add a workflow test with a fake queue: one item per paused document, and a Langfuse failure still pauses. Verify with `pnpm test apps/api`.
- [x] 3.3 RED/GREEN: the pure sync planning (`correct` → approve, `corrected` + valid → approve with invoice, `corrected` + invalid → report, `unusable` → reject, not paused → skip, no verdict → report), then the `review:sync` CLI. Verify with `pnpm test apps/api`.
- [x] 3.4 RED/GREEN: the pure golden merge (upsert by document id, excluding `unusable`, sorted), then the `golden:export` CLI. Verify with `pnpm test apps/api`.
- [x] 3.5 Write ADR-0013, link it from `docs/architecture.md`, and write `docs/review.md` (how to review in Langfuse: verdict, corrected output in cents with an example, then sync and export). Verify that the links resolve.

## 4. The loop, for real

- [x] 4.1 With Langfuse up and part 1 seeded, run `pnpm synth:review --count 12` and process the 12 files through the workflow. Verify that the queue shows 12 pending items with source text, invoice and rule scores (API check, plus a UI screenshot through headless Playwright).
- [x] 4.2 Hand-off: the author reviews at least 10 items in the Langfuse UI (at least 3 `corrected`). This is a human task; the agent stops here and waits.
- [x] 4.3 Run `pnpm review:sync`, then `pnpm golden:export`. Verify that the runs are resolved (DB statuses), that `golden.jsonl` has one record per reviewed document, that a second sync resolves nothing, and that the corrected values match what was entered. Record the numbers in `docs/review.md`.
- [ ] 4.4 Run `pnpm lint && pnpm typecheck && pnpm test && pnpm py:check`, open the PR and confirm that CI is green.
