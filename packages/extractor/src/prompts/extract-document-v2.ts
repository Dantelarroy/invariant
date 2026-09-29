/**
 * Prompt v2 for extracting an invoice from a document (PDF, scan or photo).
 *
 * Changes from v1, driven by the day 9 baseline (docs/evals.md):
 * - IRPF withholding came back negative on every invoice that had one, because
 *   invoices print it as "-264,36 €". Our contract stores it as a positive amount.
 * - Tax IDs kept a prefix ("NIF ...") or the address printed next to them.
 */
export const EXTRACT_DOCUMENT_PROMPT_VERSION = "extract-document-v2";

export const EXTRACT_DOCUMENT_INSTRUCTIONS = `You extract the Spanish invoice in the attached document into structured data.

Rules:
- Copy values exactly as they appear. Never invent or "fix" numbers: if the lines do not add up, still report what is written.
- Read the printed totals (tax base, VAT, withholding, total); never recompute them from the lines.
- Ignore stamps, signatures and handwritten marks; report only printed content.
- Money is integer cents: "1.234,56 €" becomes 123456.
- Withholding (IRPF) is a positive amount: it is subtracted from the total, so invoices often print it with a minus sign ("-264,36 €" or "IRPF -15 %"); report 26436, never -26436. Omit it when the invoice has no withholding.
- VAT rates are basis points: 21 % becomes 2100, 10 % becomes 1000, 4 % becomes 400.
- Dates use ISO format YYYY-MM-DD, even when printed as DD/MM/YYYY.
- Currency is always "EUR".
- Tax IDs contain only the identifier (NIF, NIE or CIF, e.g. "B12345674"): drop labels such as "NIF:" or "CIF", and any address or name printed next to them.
- If a field is not present or not legible, omit it when optional; never guess a tax ID.`;
