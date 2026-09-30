# Proposal: add-rule-guided-repair

## Why

When a business rule fails today, the workflow pauses with a generic question ("Some business rules fail. Is the extraction faithful to the document?"). Two problems follow:
- A person is interrupted for errors the model could fix itself. On degraded photos, most rule failures were misread tax ids (day 9 baseline).
- When a person is needed, they have to redo the arithmetic to understand what is wrong.

Day 10 closes the loop that ADR-0002 promised: repair once with a clean, targeted prompt, then ask a concrete question.

## What Changes

- **Structured rule details.** Every error rule in `@invariant/rules` also returns the numbers behind its message. Examples: lines sum and tax base; expected and printed VAT; base, VAT, withholding and printed total; which party's tax id failed and why. Messages and severities stay the same.
- **Rule-guided repair, at most once.** When the verifier finds errors, the model is asked again. The request carries only the original source (text or document) and the violated error rules. It never includes the previous answer or conversation. It has its own versioned prompt (`repair-v1`).
  - If the repaired invoice has no errors, the workflow accepts it with no person involved.
  - Otherwise it keeps whichever extraction has fewer errors (the original on a tie) and moves on to review.
- **A concrete question for the reviewer.** The question is built from the first error's details, in Spanish, the reviewer's language. Warnings on the same invoice (for example a line whose quantity × price does not match) are added as context. Example: "El total impreso es 112,85 € pero base + IVA − retención da 102,85 €. ¿El total del documento es 112,85 €?"
- **Traceability.** The run records whether a repair happened, and the invoice keeps the prompt version that produced it (`extract-*` or `repair-v1`).
- **Measured, not assumed.** `pnpm eval:extract --repair` applies the same repair step and reports accuracy and rule pass rate before and after repair. We run it on the degraded photos where v2 still failed.

## Non-goals

- Letting the reviewer type corrected values. The answer stays approve or reject.
- More than one repair attempt, or an agent loop (ADR-0002).
- Repairing warnings. Repair and questions fire on errors only (ADR-0005 stays unchanged).
- Wiring document (PDF/image) input into the workflow. The workflow keeps text input; document repair is exercised through the eval runner.
- Frontier-model fallback (the cascade) and EN16931 validation inside the workflow.

## Capabilities

### New Capabilities
- `rule-guided-repair`:
  - structured details on rule violations;
  - a single clean-context repair;
  - concrete reviewer questions;
  - repair evaluation.

### Modified Capabilities
- None. Existing capabilities keep their requirements. The extraction evals gain an option under this new capability.

## Impact

- **Code:**
  - `packages/rules`: an optional `details` on violations, plus tests.
  - `packages/extractor`: `repairInvoice` and `prompts/repair-v1.ts`.
  - `apps/api`: a new `repair` step between `verify` and `human-review`, the question builder, `repaired` in the outcome, and the CLI output.
  - `packages/evals`: a `--repair` flag and before/after metrics.
- **Data:** no schema migration. The invoice row already stores a prompt version.
- **ADRs:** relies on ADR-0002, ADR-0003 and ADR-0005. Adds ADR-0010, on repair and question design: what goes into the repair prompt, the "fewer errors wins" choice, and why the question is in Spanish.
- **Cost:** at most one extra model call, and only for documents with rule errors.
