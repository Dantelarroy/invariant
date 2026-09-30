/**
 * Prompt v1 for repairing an extraction that failed business rules (ADR-0010).
 *
 * The model gets a clean context: the original source and the violated error
 * rules only, never its previous answer or conversation (keeping a failed
 * attempt in context makes retries fail more often, arXiv 2605.08563). It is
 * told to re-read the source and to copy inconsistent documents as printed, so
 * a repair never "fixes" a genuinely wrong invoice by recomputing its numbers.
 */
export const REPAIR_PROMPT_VERSION = "repair-v1";

export const REPAIR_INSTRUCTIONS = `A previous automatic extraction of this Spanish invoice failed these consistency checks. Extract the invoice again, from scratch, from the source below.

- Re-read the source carefully, paying special attention to the values the failed checks mention.
- Correct only what the source shows. The failed checks tell you where to look, not what the answer is.
- If the source itself is inconsistent (for example, its printed total does not match its base and VAT), copy the values exactly as printed. Never recompute or adjust numbers to make a check pass.`;

/** The bullet list of violated rule messages, as sent to the model. */
export function formatFailedChecks(messages: readonly string[]): string {
  return `Failed checks:\n${messages.map((m) => `- ${m}`).join("\n")}`;
}
