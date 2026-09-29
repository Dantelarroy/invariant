# UBL export results

Whether correct labeled invoices become valid EN16931 e-invoices, measured with `pnpm ubl:check` against the official CEN schematron 1.3.16 (`easybill/en16931-validator:0.7.0`). Mapping decisions are in [ADR-0009](adr/0009-ubl-mapping.md). The datasets live in the git-ignored `data/`; the numbers below are copied from the command output.

> **Scope.** These are labels, not extractions: the check proves the mapping on correct invoices. The validator checks the schematron only, not the XSD; the mapper's tests pin the element order.

## Day 10 (2026-09-29)

| | `data/synth-erp` (FacturaScripts) | `data/synth` (own templates) |
|---|---:|---:|
| Documents | 300 | 30 |
| **Valid** | **234** | **26** |
| Refused | 61 | 4 |
| Invalid | 5 | 0 |
| Warning UBL-CR-513 (IRPF) | 70 | 5 |

Commands: `pnpm ubl:check --dataset data/synth-erp` (exit status 1) and `pnpm ubl:check --dataset data/synth --limit 30` (exit status 0).

Every exported invoice of our own templates validates, and 234 of the 239 exported FacturaScripts invoices do (97.9 %).

## Why documents fail or are refused

- **Refused: no buyer tax id (61 + 4).** For example `erp-fs-000248`, `erp-fs-000148`, `erp-fs-000081` and `synth-000002`. These are invoices to private customers. A B2B e-invoice needs the buyer's tax id, so no UBL is produced and nothing is invented. This is the only refusal reason in both datasets.
- **Invalid: BR-CO-13 on 5 FacturaScripts invoices:** `erp-fs-000225`, `erp-fs-000035`, `erp-fs-000297`, `erp-fs-000207` and `erp-fs-000063`. BR-CO-13 requires the tax base (BT-109) to equal the sum of the line amounts. In each of them the printed lines differ from the printed base by exactly one cent (for example `erp-fs-000225`: lines add up to 255.70, the base is 255.71). All five have fractional quantities (18.1, 13.2, 24.5 …): FacturaScripts rounds each printed line but computes the base from the unrounded amounts (ADR-0007). Our `lines-sum` rule tolerates this, EN16931 does not. The dataset has 7 such invoices; the other 2 (`erp-fs-000272`, `erp-fs-000216`) are refused before validation.
- **BR-CO-10 never fails,** because the sum of line amounts (BT-106) is computed from the lines, and no other EN16931 error appears.
- **The one-cent VAT adjustment works.** In 5 exported invoices (`erp-fs-000074`, `erp-fs-000264`, `erp-fs-000126`, `erp-fs-000207`, `erp-fs-000075`) the printed VAT is one cent below the per-rate calculation. The cent goes to the largest breakdown (ADR-0009, decision 3), and BR-CO-14 and BR-S-09 pass in all five. `erp-fs-000207` is only invalid for BR-CO-13.
- **UBL-CR-513** is a warning on every invoice with IRPF withholding (70 + 5). It does not affect validity.

## What this means for the next decision

The printed totals are copied, not rewritten (ADR-0009, decision 4), so 5 of 239 exportable FacturaScripts invoices (2.1 %) cannot become valid e-invoices as printed. Two ways out, to decide in a later change:

1. **A document-level rounding adjustment:** an allowance or charge of one cent (BT-107/BT-108) that reconciles the lines with the printed base. The printed numbers stay intact, but the allowance or charge needs a VAT category and enters the VAT breakdown.
2. **Regenerate labels from the printed lines,** which would change the base that FacturaScripts printed.

Refusals are a data question, not a mapping one: private customers need a simplified invoice (ticket), not a B2B e-invoice.
