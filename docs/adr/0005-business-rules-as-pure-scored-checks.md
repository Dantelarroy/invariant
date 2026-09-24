# ADR-0005: Business rules as pure, scored checks

- **Status:** Accepted
- **Date:** 2026-09-24

## Context
The rules decide three things: whether an extraction can be trusted without a person, how good an extraction is when there are no labels, and the reward for training a small model. All three need the same answer for the same invoice, fast and without side effects.

## Decision
- `@invariant/rules` is a pure package: `verifyInvoice(invoice)` runs a list of `Rule`s and returns `{ valid, score, violations }`. No I/O and no model calls.
- Each violation carries a rule id, a severity, a human-readable message (shown to the reviewer) and a path to the field (usable later for targeted repair).
- **Severity.** `error` blocks automatic acceptance; `warning` is reported but does not block. Line amounts (quantity × unit price) are warnings until line discounts are modelled.
- **Tolerance.** One cent for line amounts and VAT, to absorb printed rounding. Sums of lines and the final total must match exactly.
- **VAT** is recomputed per rate group (base of the group × rate, rounded half away from zero with integer arithmetic), because Spanish invoices print one VAT amount per rate.
- **Allowed rates:** 0, 4, 10 and 21 %. 5 % is accepted only for invoices issued up to 2024-12-31, when it was temporarily in force.
- **Score** is the share of rules that hold (0–1). It is deliberately simple and dense, which makes it usable as an RL reward.

## Consequences
- New rules (tax IDs, dates, EN16931) are added to the list without changing callers.
- The workflow sends a document to human review only on errors.
- A single score per invoice lets evals compare prompts and models without labels. It only measures internal consistency, not whether values match the paper, so labelled evals are still needed.
