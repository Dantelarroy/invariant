# Reviewing invoices in Langfuse

A document that still breaks an error rule after one repair pauses for review. Its extraction goes to the Langfuse annotation queue `invariant-review`. You set a verdict there, and correct the invoice when needed. Then two commands apply your reviews: they resume the paused runs and add each document to the golden set. Decisions are in [ADR-0013](adr/0013-review-queue-in-langfuse.md).

## Quick path

1. Start Langfuse (`pnpm langfuse:up`) and sign in at <http://127.0.0.1:3000> as `dev@invariant.local` / `invariant_local_only`.
2. Open **Human Annotation → invariant-review → Process queue**.
3. For each item, read the source and the extracted invoice, set **verdict**, fix the **Corrected Output** if the verdict is `corrected`, and press **Mark Completed** (`Ctrl + Enter`).
4. Apply the reviews:

   ```sh
   pnpm review:sync     # resumes each paused run: approve, approve with the correction, or reject
   pnpm golden:export   # upserts data/golden/golden.jsonl (git-ignored)
   ```

Both commands need `LANGFUSE_BASE_URL` (in `.env`), and both are safe to re-run.

## What an item shows

| Where | What |
|---|---|
| Header | Latency, cost, tokens and the tags `pipeline` and `needs_review`. |
| **Input** | `promptVersion` and `source`, the invoice text the model read. The *Formatted* view collapses spaces; switch to *Raw* to see the columns. |
| **Output** | The extracted invoice. Amounts are integer cents: `totalCents: 64889` is 648,89 €. |
| Scores (detailed view) | `rule.<id>` per business rule, `rules.score` and `rules.valid`. A failed rule's comment says what did not add up. |
| Trace | The `human-review` step holds the Spanish question, e.g. *"El total impreso es 648,89 € pero base + IVA − retención da 638,89 €…"*. |

The queued generation is the one that was kept: the extraction, or `repair-v1` when the repair was chosen.

## Verdicts

The question is always: **does the output say what the document says?**

| Verdict | When | What sync does |
|---|---|---|
| `correct` | The output copies the document faithfully, even when the document itself is wrong (a printed total that does not add up). | Approves the extraction as it is. |
| `corrected` | The model misread something. You fix it in the corrected output. | Approves your corrected invoice. |
| `unusable` | The document is not an invoice, or cannot be read. | Rejects the document. It stays out of the golden set. |

The golden set is **"as printed"**: it records what the document says, not what it should have said. So a faithful copy of a wrong total is `correct`, and it is not "fixed".

## Corrected output

- Under **Output**, click **Correct output**, then **Click to add corrected output**. The editor opens **pre-filled with the extracted invoice** as indented JSON (checked on Langfuse 4.47.0).
- It **saves as soon as it opens**, even before you type (a score named `output`, type correction). If you then choose `correct`, that copy is ignored, so this is harmless.
- Change only the wrong values, and keep the whole invoice: every field, valid JSON.
- **Money is integer cents.** Write `10285`, never `102.85` or `"102,85 €"`. VAT rates are basis points: 21 % is `2100`.
- `withholdingCents` (IRPF) is a **positive** amount, even though the document prints it as `-136,58 €`.

Example: the model read the withholding as negative. Change one line of the pre-filled JSON:

```diff
   "taxBaseCents": 91054,
   "vatAmountCents": 20121,
-  "withholdingCents": -13658,
+  "withholdingCents": 13658,
   "totalCents": 96517
```

Sync validates the correction against the invoice schema. If it is not valid (not JSON, a float, a missing field), sync names the document and the error and leaves the run paused. Fix the corrected output, then run `pnpm review:sync` again.

## What sync and export do

- **Sync** reads the completed items, maps each one to its paused run (the generation carries `runId` and `documentId`) and resumes it. `correct` approves the extraction. `corrected` approves your invoice. `unusable` rejects.
  - It skips a document that is no longer waiting for review. A second sync, or a document already answered with `pnpm review <run-id>`, changes nothing.
  - It reports, and does not resume, an item without a verdict, or a `corrected` item without a valid correction.
  - When there are several corrections, yours wins over any added through the API, then the latest.
- **Export** writes one JSON line per `correct` or `corrected` document, sorted by document id: `{ id, documentId, verdict, invoice, text, traceId, observationId, promptVersion, reviewedAt, source: "langfuse-review" }`. Records are upserted by document id. A document later marked `unusable` is removed.
- The terminal review (`pnpm review <run-id> approve|reject`) still works. It cannot correct values.

## Review fixtures

```sh
pnpm synth:review --count 12 --seed 1              # data/review-fixtures/*.txt + manifest.jsonl
pnpm extract:text data/review-fixtures/review-000001.txt   # one at a time
```

- Each text invoice is a seeded synthetic invoice with **one printed error**. The kinds rotate: `wrong-total`, `wrong-vat`, `invalid-tax-id`, `line-amount`.
- The manifest holds each file's error, with the true and the printed value, and the true invoice. File names do not give the error away.
- The same seed and count always give the same files.

## Day 12 run (2026-09-30)

The 12 fixtures (`--count 12 --seed 1`) were processed with tracing on, gpt-5-mini and `extract-text-v1`. **All 12 paused and are in the queue, one pending item each** (queue `cmuo9glqy000rn007o3ubmbli`, verdict config `4dc7350c-dc36-4734-ab52-65543810b205`).

| Files | Printed error | Rules that failed | The extraction also… |
|---|---|---|---|
| 001, 005, 009 | wrong total | `total` | 005: withholding negative |
| 002, 006, 010 | wrong VAT | `vat-amount`, `total` | 002: withholding negative |
| 003, 007, 011 | invalid supplier tax id | `tax-ids` (003 also `total`) | 003: withholding negative; 007: the repair was kept |
| 004, 008, 012 | line amount | `lines-sum`, `vat-amount`, `line-amount` (004 also `total`) | 004: withholding negative; 012: line 1 read at 10 % instead of 4 % |

- The `line-amount` fixtures pause too. The rule itself is only a warning, but a wrong line no longer adds up to the printed base, so `lines-sum` fails.
- The model read every IRPF withholding (`-136,58 €`) as a negative amount. That makes `total` fail even where the printed total was right. These items (002, 003, 004, 005) and 012 need `corrected`. The others copy the document faithfully and are `correct`.

### Review, sync and export

Dante reviewed all 12 items in the Langfuse UI: **7 `correct`, 5 `corrected`**.
- **002, 003, 004, 005:** `withholdingCents` made positive.
- **012:** line 1 (milk) `vatRateBps` 1000 → 400. The printed 4 % base, 29,52 €, is milk plus tomato.

`pnpm review:sync`:

```text
12 completed reviews · 12 resumed · 0 already resolved · 0 need attention
```

- All 12 paused runs were accepted, reviewed by `langfuse:<user id>`. 007 is marked `repaired`, because the repair was the extraction under review.
- For corrected invoices the sync logs which rules still fail, for example `still breaks: total`. That is expected: the golden invoice is what is printed, and each fixture prints one error on purpose (ADR-0013).
- A second `pnpm review:sync` resumed nothing: `12 completed reviews · 0 resumed · 12 already resolved`.

`pnpm golden:export`:

```text
✔ 12 golden records (7 correct · 5 corrected; 0 before) · 0 skipped
```

`data/golden/golden.jsonl` has 12 records. The corrected values match what was entered:
- withholding 13658, 63460, 40506 and 1905 cents;
- `FAC-2025-2454` with line rates `400,1000,1000,400`.

**Finding for the next change:** `extract-text-v1` reads a printed IRPF withholding as negative, the same failure `extract-document-v2` fixed for documents. The four corrected records are the evidence for an `extract-text-v2`.

### Follow-up: `extract-text-v2` (2026-10-02)

`extract-text-v2` adds the two rules that `extract-document-v2` added for documents: withholding (IRPF) is a positive amount, and tax ids are bare identifiers. It is registered in Langfuse as `extract-text` version 2 (`pnpm prompts:seed`: 1 created, 4 already registered).

The four fixtures that needed a withholding correction (002–005) were run again with gpt-5-mini, from copies with a marker line:

| Fixture | Rules failing with v1 | Rules failing with v2 | Printed error |
|---|---|---|---|
| 002 | `vat-amount`, `total` | `vat-amount`, `total` | wrong VAT |
| 003 | `tax-ids`, `total` | `tax-ids` | invalid tax id |
| 004 | `lines-sum`, `vat-amount`, `line-amount`, `total` | `lines-sum`, `vat-amount`, `line-amount` | line amount |
| 005 | `total` | `total` | wrong total |

- **Withholding is now positive in all four.** The `total` messages compute base + VAT − withholding with the positive amount: for 005, 127,00 + 26,67 − 19,05 = 134,62 €.
- **Only the printed errors remain.** On 003 and 004, `total` no longer fails, because the negative withholding was what broke it. That matches the four golden records. The check runs were rejected afterwards.
