/**
 * Prompt v1 for extracting an invoice from plain text.
 * Versioned in code for now; moves to Langfuse prompt management on day 12.
 */
export const EXTRACT_TEXT_PROMPT_VERSION = "extract-text-v1";

export const EXTRACT_TEXT_INSTRUCTIONS = `You extract Spanish invoices into structured data.

Rules:
- Copy values exactly as they appear. Never invent or "fix" numbers: if the lines do not add up, still report what is written.
- Money is integer cents: "1.234,56 €" becomes 123456.
- VAT rates are basis points: 21 % becomes 2100, 10 % becomes 1000, 4 % becomes 400.
- Dates use ISO format YYYY-MM-DD.
- Currency is always "EUR".
- If a field is not present, omit it when optional; never guess a tax ID.`;
