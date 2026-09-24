import type { Invoice } from "@invariant/schema";
import { generateText, type LanguageModel, Output } from "ai";
import { ModelInvoiceSchema, toInvoice } from "./model-output-schema.js";
import {
  EXTRACT_TEXT_INSTRUCTIONS,
  EXTRACT_TEXT_PROMPT_VERSION,
} from "./prompts/extract-text-v1.js";

export interface ExtractionResult {
  invoice: Invoice;
  promptVersion: string;
  usage: { inputTokens: number | undefined; outputTokens: number | undefined };
}

/**
 * Extracts an invoice from its plain-text content using a language model.
 *
 * The model is injected, so production passes a real provider and tests pass
 * a mock. The output is converted and validated against InvoiceSchema (shape only); business
 * rules are checked later by @invariant/rules.
 */
export async function extractInvoiceFromText(
  text: string,
  model: LanguageModel,
): Promise<ExtractionResult> {
  const result = await generateText({
    model,
    system: EXTRACT_TEXT_INSTRUCTIONS,
    prompt: text,
    output: Output.object({ schema: ModelInvoiceSchema, name: "invoice" }),
  });

  return {
    invoice: toInvoice(result.output),
    promptVersion: EXTRACT_TEXT_PROMPT_VERSION,
    usage: {
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    },
  };
}
