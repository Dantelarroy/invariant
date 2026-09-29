import type { LanguageModel } from "ai";
import {
  type ExtractionResult,
  extractWithModel,
} from "./extract-with-model.js";
import {
  EXTRACT_TEXT_INSTRUCTIONS,
  EXTRACT_TEXT_PROMPT_VERSION,
} from "./prompts/extract-text-v1.js";

/**
 * Extracts an invoice from its plain-text content using a language model.
 *
 * The model is injected, so production passes a real provider and tests pass
 * a mock. The output is converted and validated against InvoiceSchema (shape only); business
 * rules are checked later by @invariant/rules.
 */
export function extractInvoiceFromText(
  text: string,
  model: LanguageModel,
): Promise<ExtractionResult> {
  return extractWithModel(
    {
      instructions: EXTRACT_TEXT_INSTRUCTIONS,
      messages: [{ role: "user", content: text }],
    },
    model,
    EXTRACT_TEXT_PROMPT_VERSION,
  );
}
