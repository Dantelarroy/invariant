import { type PromptDefinition, promptId } from "./definition.js";

/**
 * Prompt v1 for extracting an invoice from plain text.
 * Registered in Langfuse prompt management as "extract-text" version 1 (ADR-0012).
 */
export const EXTRACT_TEXT_INSTRUCTIONS = `You extract Spanish invoices into structured data.

Rules:
- Copy values exactly as they appear. Never invent or "fix" numbers: if the lines do not add up, still report what is written.
- Money is integer cents: "1.234,56 €" becomes 123456.
- VAT rates are basis points: 21 % becomes 2100, 10 % becomes 1000, 4 % becomes 400.
- Dates use ISO format YYYY-MM-DD.
- Currency is always "EUR".
- If a field is not present, omit it when optional; never guess a tax ID.`;

export const EXTRACT_TEXT_PROMPT: PromptDefinition = {
  name: "extract-text",
  version: 1,
  text: EXTRACT_TEXT_INSTRUCTIONS,
};

/** Our id for this version ("extract-text-v1"), as stored with invoices and in eval reports. */
export const EXTRACT_TEXT_PROMPT_VERSION = promptId(EXTRACT_TEXT_PROMPT);
