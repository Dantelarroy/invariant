import { type PromptDefinition, promptId } from "./definition.js";

/**
 * Prompt v1 for extracting an invoice from a document (PDF, scan or photo).
 * Superseded by extract-document-v2; kept so v1 eval reports stay reproducible.
 * Versioned separately from the text prompt, because reading a document has
 * its own failure modes and evals must tell the two apart.
 */
export const EXTRACT_DOCUMENT_INSTRUCTIONS = `You extract the Spanish invoice in the attached document into structured data.

Rules:
- Copy values exactly as they appear. Never invent or "fix" numbers: if the lines do not add up, still report what is written.
- Read the printed totals (tax base, VAT, withholding, total); never recompute them from the lines.
- Ignore stamps, signatures and handwritten marks; report only printed content.
- Money is integer cents: "1.234,56 €" becomes 123456.
- VAT rates are basis points: 21 % becomes 2100, 10 % becomes 1000, 4 % becomes 400.
- Dates use ISO format YYYY-MM-DD, even when printed as DD/MM/YYYY.
- Currency is always "EUR".
- If a field is not present or not legible, omit it when optional; never guess a tax ID.`;

export const EXTRACT_DOCUMENT_PROMPT: PromptDefinition = {
  name: "extract-document",
  version: 1,
  text: EXTRACT_DOCUMENT_INSTRUCTIONS,
};

/** Our id for this version ("extract-document-v1"), as stored with invoices and in eval reports. */
export const EXTRACT_DOCUMENT_PROMPT_VERSION = promptId(
  EXTRACT_DOCUMENT_PROMPT,
);
