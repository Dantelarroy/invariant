# Extraction evals

How well the document extractor reads invoices, measured with `pnpm eval:extract` against labeled datasets. Scoring rules are in [ADR-0008](adr/0008-scoring-extractions.md): exact cents for amounts, identifiers compared without case, spaces, dots or hyphens, lines scored by count only. Reports live in the git-ignored `data/evals/`; the numbers below are copied from them.

> **Caveat.** None of these numbers is real-world accuracy. FacturaScripts prints every invoice with the same layout, and `data/synth` comes from our own templates (ADR-0007). They are regression and comparison baselines. Only the real benchmark (`data/real`, not annotated yet) will be reported as accuracy.

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
