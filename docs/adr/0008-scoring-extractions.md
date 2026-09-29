# ADR-0008: Scoring extractions field by field, next to the rule verdict

- **Status:** Accepted
- **Date:** 2026-09-29

## Context
We now read invoices from PDFs and images, and we have 360 labeled invoices on disk (300 printed by FacturaScripts, 60 from our own templates). Before building repair, UBL or training on top of the extractor, we need a number for how well it reads, and a way to compare models and prompts on the same data.

"How well" needs a precise definition. Loose matching would hide real errors; overly strict matching would count formatting as mistakes. We also have a second, label-free signal: the business rules (ADR-0005). An extraction can pass every rule and still be wrong, so the two signals must not be confused.

## Decision
`@invariant/evals` scores each extraction against its label with `scoreExtraction(expected, actual, { today })`:

1. **Scored fields:** invoice number, issue date, supplier tax id, customer tax id, tax base, VAT amount, withholding, total, and the number of lines.
2. **Amounts match exactly in cents.** A 1-cent miss on a total is a real accounting error. The rules already allow rounding tolerance where the law does, so the scorer does not add its own.
3. **Identifiers are normalized.** Tax ids and invoice numbers are compared after removing case, spaces, dots and hyphens, so `b-12345674` matches `B12345674`. These differences are formatting, not reading errors.
4. **Dates match as ISO strings.** The schema already forces `YYYY-MM-DD`.
5. **Absent in both is a match.** An invoice without withholding, read as having none, is correct. Absent on one side only is a mismatch.
6. **Lines are scored by count only, for now.** Matching individual lines (description, quantity, unit price) needs an alignment decision when the model merges, splits or reorders lines. That is deferred to a later change.
7. **A failed extraction mismatches every field**, including fields absent in the label, and its rule verdict is invalid.
8. **Rule verdict next to accuracy.** Every document also reports `verifyInvoice(actual, { today })`: whether it is valid and which rules failed. `today` is fixed per run, so scores are reproducible.

`summarize(results)` aggregates a run: documents, per-field accuracy, exact-match rate, rule pass rate, failures, total tokens and median latency.

## Consequences
- Accuracy and rule pass rate are reported side by side. The gap between them measures how often the rules miss a wrong extraction ("wrong but consistent"), which matters because the rules are also the cascade trigger and the RL reward.
- Exact cents make the metric harsh on sums, on purpose. A model that is often a cent off shows up immediately.
- Line count is a weak line metric: a model that gets the number of lines right but misreads them still scores. This is explicit and will be replaced by per-line matching.
- The scorer is pure and fully unit-tested; only the runner does I/O and calls models.
