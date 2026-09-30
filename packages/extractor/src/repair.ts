import type { LanguageModel, TextPart } from "ai";
import { assertSupported, type Document } from "./extract-from-document.js";
import {
  type ExtractionOptions,
  type ExtractionResult,
  extractWithModel,
} from "./extract-with-model.js";
import { EXTRACT_DOCUMENT_INSTRUCTIONS } from "./prompts/extract-document-v2.js";
import { EXTRACT_TEXT_INSTRUCTIONS } from "./prompts/extract-text-v1.js";
import {
  formatFailedChecks,
  REPAIR_INSTRUCTIONS,
  REPAIR_PROMPT_VERSION,
} from "./prompts/repair-v1.js";

/** What was extracted from: the same text or document as the first attempt. */
export type RepairSource = { text: string } | { document: Document };

/** A rule violation as reported by @invariant/rules (only what repair needs). */
export interface RepairIssue {
  severity: "error" | "warning";
  message: string;
}

/**
 * Extracts the invoice once more, telling the model which error rules the
 * first attempt violated (ADR-0010). The request holds the repair
 * instructions, the error messages and the original source only: never the
 * previous answer, the previous conversation or any warning.
 *
 * Throws when `issues` holds no error: repairing a valid extraction is a
 * programming error, and the caller decides whether a repair is due.
 * `options.instructions` replaces the repair prompt text; the failed checks
 * and the extraction rules are still appended.
 */
export async function repairInvoice(
  source: RepairSource,
  issues: readonly RepairIssue[],
  model: LanguageModel,
  options: ExtractionOptions = {},
): Promise<ExtractionResult> {
  const errors = issues
    .filter((issue) => issue.severity === "error")
    .map((issue) => issue.message);
  if (errors.length === 0) {
    throw new Error("repairInvoice called with no error to repair");
  }
  if ("document" in source) assertSupported(source.document);

  const extractionRules =
    "text" in source
      ? EXTRACT_TEXT_INSTRUCTIONS
      : EXTRACT_DOCUMENT_INSTRUCTIONS;
  const instructions: TextPart = {
    type: "text",
    text: `${options.instructions ?? REPAIR_INSTRUCTIONS}\n\n${formatFailedChecks(errors)}\n\n${extractionRules}`,
  };

  return extractWithModel(
    {
      messages: [
        {
          role: "user",
          content: [
            instructions,
            "text" in source
              ? { type: "text", text: source.text }
              : {
                  type: "file",
                  mediaType: source.document.mediaType,
                  data: source.document.bytes,
                },
          ],
        },
      ],
    },
    model,
    REPAIR_PROMPT_VERSION,
  );
}

/**
 * The selection rule (ADR-0010): use the repaired extraction when it has no
 * errors, otherwise only when it has fewer errors than the original. A tie
 * keeps the original, so a repair never changes numbers without evidence.
 */
export function shouldUseRepair(
  originalErrors: number,
  repairedErrors: number,
): boolean {
  return repairedErrors < originalErrors;
}
