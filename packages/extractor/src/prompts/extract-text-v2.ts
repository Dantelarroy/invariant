import { type PromptDefinition, promptId } from "./definition.js";

/**
 * Prompt v2 for extracting an invoice from plain text.
 * Registered in Langfuse prompt management as "extract-text" version 2 (ADR-0012).
 *
 * Changes from v1, driven by the day 12 review (docs/review.md): the four
 * corrected golden records had IRPF withholding extracted as a negative
 * amount, because invoices print it as "-136,58 €". The same two rules that
 * extract-document-v2 added for documents are added here.
 */
export const EXTRACT_TEXT_INSTRUCTIONS = `You extract Spanish invoices into structured data.

Rules:
- Copy values exactly as they appear. Never invent or "fix" numbers: if the lines do not add up, still report what is written.
- Money is integer cents: "1.234,56 €" becomes 123456.
- Withholding (IRPF) is a positive amount: it is subtracted from the total, so invoices often print it with a minus sign ("-264,36 €" or "IRPF -15 %"); report 26436, never -26436. Omit it when the invoice has no withholding.
- VAT rates are basis points: 21 % becomes 2100, 10 % becomes 1000, 4 % becomes 400.
- Dates use ISO format YYYY-MM-DD.
- Currency is always "EUR".
- Tax IDs contain only the identifier (NIF, NIE or CIF, e.g. "B12345674"): drop labels such as "NIF:" or "CIF", and any address or name printed next to them.
- If a field is not present, omit it when optional; never guess a tax ID.`;

export const EXTRACT_TEXT_PROMPT: PromptDefinition = {
  name: "extract-text",
  version: 2,
  text: EXTRACT_TEXT_INSTRUCTIONS,
};

/** Our id for this version ("extract-text-v2"), as stored with invoices and in eval reports. */
export const EXTRACT_TEXT_PROMPT_VERSION = promptId(EXTRACT_TEXT_PROMPT);
