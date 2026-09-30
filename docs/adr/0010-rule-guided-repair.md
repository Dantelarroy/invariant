# ADR-0010: Rule-guided repair and concrete review questions

- **Status:** Accepted
- **Date:** 2026-09-30

## Context
ADR-0002 promised a targeted repair, at most once, before a person is asked. Until now a failed error rule (ADR-0005) paused the workflow with a fixed question: "Some business rules fail. Is the extraction faithful to the document?". On the day 9 baseline most failures on degraded photos were misread tax ids, which the model could often fix by reading again, and a reviewer who was asked had to redo the arithmetic to find what was wrong.

We must decide what the repair request contains, which extraction wins afterwards, which issues trigger a repair or a question, and in which language the reviewer is asked.

## Decision
1. **Structured details on violations.** Every error rule also returns the values it compared (`details`, amounts in integer cents), e.g. `total` returns base, VAT, withholding, expected and printed total. The `line-amount` warning does too, because the question uses it as context. Messages, severities and paths stay byte-identical, so existing consumers are unaffected.
2. **One repair, in a clean context.** `repairInvoice(source, issues, model)` in `@invariant/extractor` sends one user message: the repair instructions (prompt `repair-v1`, which embeds the extraction rules for text or documents), the violated **error** messages as a bullet list, and the original source (the same text, or the same bytes and media type as a `file` part). It never sends the previous answer, the previous conversation or any warning. Keeping a failed attempt in context makes a retry fail far more often (arXiv 2605.08563), so we clear it. Sending only the violated rules is our own choice; the paper does not test it. The messages quote the values the model read ("Total is 112,85 €…"), which re-exposes part of the failed attempt: the model needs to know what to re-check, and the full previous JSON stays out.
3. **Copy what is printed.** The repair prompt tells the model to correct only what the source shows and, when the document itself is inconsistent, to copy it as printed. A repair must never "fix" a genuinely wrong invoice by recomputing its numbers.
4. **Selection: no errors wins, otherwise fewer errors, otherwise the original.** `shouldUseRepair(originalErrors, repairedErrors)` is `repairedErrors < originalErrors`. A tie keeps the original, so a repair never changes numbers without evidence of improvement. The invoice keeps the prompt version of the extraction that was chosen (`extract-*` or `repair-v1`), and the run's outcome says whether it was `repaired`. There is never a second repair (ADR-0002): no loops, no agent.
5. **Errors only.** Repair and questions fire on errors. Warnings (ADR-0005) are never repaired and never sent to the model; they only add context to the question.
6. **Workflow shape.** A `repair` step sits between `verify` and `human-review`. It reads the source text with `getInitData()` instead of threading it through every step schema. A failed repair call keeps the original extraction instead of failing the document. mastra resumes a suspended run by step position, so a run suspended before this step existed would resume at `repair`: the step skips itself when the document is already `needs_review`, so the reviewer's decision applies to the extraction they were shown, with no extra model call.
7. **Concrete questions, in Spanish.** `buildReviewQuestion(issues)` picks the first error in `RULES` order (so `lines-sum` and `vat-amount` come before `total`, the likelier root causes), renders one Spanish sentence per rule with `formatMoney`, states the conflicting values and asks about the one printed on the document. It appends one sentence per `line-amount` warning. Example: "El total impreso es 112,85 € pero base + IVA − retención da 102,85 €. ¿El total del documento es 112,85 €?". Spanish, because the reviewer reads Spanish invoices; the question is data, like `formatMoney` (AGENTS.md). Code, tests and rule messages stay in English. The review request keeps the full list of issues, and an error without details falls back to a general question.
8. **Measured, not assumed.** `pnpm eval:extract --repair` runs the same repair and selection and reports accuracy and rule pass rate before and after repair, plus repairs attempted and used ([docs/evals.md](../evals.md)).

## Consequences
- At most one extra model call per document, and only for documents with rule errors.
- A repair that repeats the same mistake changes nothing: the tie keeps the original and a person still reviews it.
- The reviewer still answers approve or reject. Typing corrected values is a later change.
- Adding an error rule now means adding its `details` and a question case, with a test for each.
- Document (PDF or image) repair is exercised through the eval runner; the workflow keeps text input until document input is wired.
- Whether the repair should switch to a larger model (the cascade) is deferred to the cascade change.
