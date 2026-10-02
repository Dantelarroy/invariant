# Extraction evals

How well the document extractor reads invoices, measured with `pnpm eval:extract` against labeled datasets. Scoring rules are in [ADR-0008](adr/0008-scoring-extractions.md): exact cents for amounts, identifiers compared without case, spaces, dots or hyphens, lines scored by count only. Reports live in the git-ignored `data/evals/`; the numbers below are copied from them.

> **Caveat.** None of these numbers is real-world accuracy. FacturaScripts prints every invoice with the same layout, and `data/synth` comes from our own templates (ADR-0007). They are regression and comparison baselines. Only the real benchmark (`data/real`, not annotated yet) will be reported as accuracy.

## Unlabeled runs

`pnpm eval:extract --sources data/real/public/sources.jsonl --use eval --limit 21 --repair` runs the extractor over documents that have no label yet, such as the public examples in `data/real/public`. It keeps the manifest entries whose `use` matches `--use` (default `eval`) and takes each file's media type from its extension, so one run can mix PNG, JPEG, WebP and PDF. Without a label nothing can be matched: each document is scored on the business rules only, and the summary reports documents, rule pass rate, failures, tokens and median latency, with no field accuracy or exact match (with `--repair`, before and after). Traces go to the `eval` environment like labeled runs, with the rule scores of every generation and `file` and `source` (e.g. `declarando`, `quipu`) as trace metadata, so the traces can be read by hand and filtered for error analysis.

## Day 9 baseline (2026-09-29)

Prompt `extract-document-v1`, first 20 labels of each dataset, one document at a time.

| Metric | gpt-5-mini · ERP PDF | gpt-5 · ERP PDF | gpt-5-mini · synth JPEG |
|---|---:|---:|---:|
| Dataset | `data/synth-erp` | `data/synth-erp` | `data/synth` (degraded photos) |
| Documents | 20 | 20 | 20 |
| Invoice number | 100.0 % | 100.0 % | 90.0 % |
| Issue date | 100.0 % | 100.0 % | 100.0 % |
| Supplier tax id | 95.0 % | 100.0 % | 75.0 % |
| Customer tax id | 100.0 % | 100.0 % | 90.0 % |
| Tax base | 100.0 % | 100.0 % | 100.0 % |
| VAT amount | 100.0 % | 100.0 % | 100.0 % |
| Withholding | 60.0 % | 60.0 % | 70.0 % |
| Total | 100.0 % | 100.0 % | 100.0 % |
| Line count | 100.0 % | 100.0 % | 100.0 % |
| **Exact match** | **60.0 %** | **60.0 %** | **60.0 %** |
| **Rule pass** | **60.0 %** | **60.0 %** | **65.0 %** |
| Failed extractions | 0 | 0 | 0 |
| Tokens in / out | 28,959 / 29,375 | 24,287 / 39,766 | 29,483 / 29,816 |
| Median latency | 14,735 ms | 20,531 ms | 15,059 ms |

Reports: `synth-erp-gpt-5-mini-20260929T185510.json`, `synth-erp-gpt-5-20260929T190049.json`, `synth-gpt-5-mini-20260929T191320.json`.

## Failure patterns

- **Withholding sign (all three runs).** Every invoice with an IRPF withholding was extracted with a negative amount, e.g. `erp-fs-000067` expected `26436`, got `-26436`, and `synth-000003` expected `63460`, got `-63460`. It is the only miss for gpt-5 (8 of 8 withholding invoices) and explains all of its non-exact documents. The schema stores withholding as a positive amount that the total subtracts. The rules catch every case (`total` fails), so this is a prompt problem, not a reading one: the next prompt version should say that withholding is reported as a positive amount.
- **Tax ids with extra text.** `erp-fs-000081` (gpt-5-mini, PDF) returned `01982201S - Av. de la Constitución 15`, and `synth-000002` returned `NIF 86431172R`: the model keeps labels and neighbouring text. Normalization removes spaces, dots and hyphens, not words, on purpose.
- **Character confusion on degraded photos.** `synth-000004` read `25096673Q` as `250966730` (Q → 0), `synth-000015` read `B26930339` as `826930339` (B → 8), and `synth-000020` swapped digits in both tax ids. The `tax-ids` rule catches these through the check character.
- **Wrong but consistent.** `synth-000018` read the invoice number `F-2025-3959` as `F-2025-3950` and passed every rule. The rules cannot see this kind of error; this is why accuracy is reported next to the rule pass rate.
- **Missing tax ids.** `synth-000005` returned no tax id for either party, besides a misread number.

## Observations

- On clean ERP PDFs, gpt-5 is no more accurate than gpt-5-mini once the withholding sign is set aside (gpt-5-mini adds one tax id miss). It is slower (median 20.5 s against 14.7 s, with one 322 s outlier on `erp-fs-000148`) and uses more output tokens.
- Totals, tax base, VAT, dates and line counts were read exactly in all 60 documents, photos included.
- Rule pass rate tracks exact match closely, except for the wrong-but-consistent case above. That supports using the rules as the cascade trigger, with the known blind spot of identifiers and invoice numbers.

## Prompt v2 (2026-09-29)

`extract-document-v2` adds two instructions, one per v1 failure pattern: withholding (IRPF) is reported as a positive amount even when printed with a minus sign, and tax ids contain only the identifier, without labels or neighbouring text. Same datasets, same first 20 labels, gpt-5-mini only.

| Metric | v1 · ERP PDF | **v2 · ERP PDF** | v1 · synth JPEG | **v2 · synth JPEG** |
|---|---:|---:|---:|---:|
| Supplier tax id | 95.0 % | **100.0 %** | 75.0 % | 75.0 % |
| Customer tax id | 100.0 % | 95.0 % | 90.0 % | 90.0 % |
| Withholding | 60.0 % | **100.0 %** | 70.0 % | **100.0 %** |
| **Exact match** | 60.0 % | **95.0 %** | 60.0 % | **70.0 %** |
| **Rule pass** | 60.0 % | **100.0 %** | 65.0 % | **75.0 %** |
| Tokens in / out | 28,959 / 29,375 | 31,179 / 28,207 | 29,483 / 29,816 | 31,703 / 28,148 |
| Median latency | 14,735 ms | 11,919 ms | 15,059 ms | 13,085 ms |

Every other field stays at 100 %, except the JPEG invoice number at 90 %. Reports: `synth-erp-gpt-5-mini-20260929T193841.json`, `synth-gpt-5-mini-20260929T194317.json`.

- **Withholding is solved:** 100 % on both datasets.
- **The only ERP miss left** is `erp-fs-000170`, where the customer tax id was omitted. The rules cannot flag a missing optional field.
- **What remains on photos is reading, not instructions:**
  - character confusions in tax ids: `synth-000004` Q → 0, `synth-000015` B → 8, `synth-000020` a dropped digit;
  - `synth-000005`, with three misreads.

  The `tax-ids` rule catches all of them except the wrong-but-consistent invoice number in `synth-000018`, which is still silent.
- **Next levers for photos:** a frontier fallback triggered by rule failures (the cascade), or a higher-resolution image. Prompt wording has done its part.

## Rule-guided repair (2026-09-30)

`pnpm eval:extract --dataset data/synth --format jpg --limit 20 --repair`, gpt-5-mini, `extract-document-v2` + `repair-v1`. Every extraction with rule errors is extracted once more with only the violated error rules and the same image, and the better one is kept: no errors wins, otherwise fewer errors, and a tie keeps the original ([ADR-0010](adr/0010-rule-guided-repair.md)). "Before" scores the first extraction and "after" the one that was kept; tokens and latency after repair include the repair calls.

| Metric | Before repair | After repair |
|---|---:|---:|
| Invoice number | 90.0 % | 90.0 % |
| Supplier tax id | 75.0 % | 75.0 % |
| Customer tax id | 90.0 % | 90.0 % |
| **Exact match** | 70.0 % | 70.0 % |
| **Rule pass** | 75.0 % | 75.0 % |
| Failures | 0 | 0 |
| Tokens in / out | 31,703 / 28,914 | 40,300 / 36,123 |
| Median latency | 9,983.5 ms | 11,956.5 ms |
| Repairs attempted | | 5 |
| Repairs used | | 0 |

Every other field stays at 100 % on both sides. Report: `synth-gpt-5-mini-20260930T055126.json`.

- **Repair fixed nothing on these photos.** The 5 attempts are exactly the 5 documents failing `tax-ids` (`synth-000002`, `-000004`, `-000005`, `-000015`, `-000020`). Every repaired extraction still failed `tax-ids`, so each was a tie and the original was kept. Reading again with the failed check in hand does not recover a character the image does not show clearly: the next lever remains a stronger reader (the cascade) or a higher-resolution image.
- **The selection rule did its job.** No repaired extraction replaced a first one without fewer errors, so accuracy could not drop. The cost was one extra call on 5 of 20 documents: +27 % input and +25 % output tokens over the run.
- **`synth-000018` stays silent.** Its misread invoice number passes every rule, so it is never repaired.
- **What the report cannot say yet:** whether the repaired tax ids were the same misread or a different one, because the report keeps only the scores of the extraction that was kept.

### The question for a wrong printed total

`fixtures/text/invoice-002-wrong-total.txt` prints base 85,00 €, VAT 17,85 € and total 112,85 € (base + VAT is 102,85 €). The document itself is inconsistent, so repair cannot fix it and must not recompute the total. Because the fixture was already processed before this change (idempotency by SHA-256), it was run from a copy with a trailing newline added, through the full workflow with gpt-5-mini (2026-09-30):

```
⏸ needs review · run 4837d0d7-59ec-40d0-83e8-74a96021aec5
  - Total is 112,85 € but base + VAT − withholding is 102,85 €.
  El total impreso es 112,85 € pero base + IVA − retención da 102,85 €. ¿El total del documento es 112,85 €?
```

The repair ran once, the printed total was kept as printed, and the run paused with the concrete question instead of the old generic one.
