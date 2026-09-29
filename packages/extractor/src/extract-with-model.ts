import type { Invoice } from "@invariant/schema";
import {
  generateText,
  type LanguageModel,
  type ModelMessage,
  Output,
} from "ai";
import { ModelInvoiceSchema, toInvoice } from "./model-output-schema.js";

export interface ExtractionResult {
  invoice: Invoice;
  promptVersion: string;
  usage: { inputTokens: number | undefined; outputTokens: number | undefined };
}

/** What the model is asked: optional instructions plus the conversation. */
export interface ExtractionPrompt {
  /** Sent as the AI SDK `instructions` (system prompt); `messages` may not hold system messages. */
  instructions?: string;
  messages: ModelMessage[];
}

/**
 * The extraction core shared by the text and document entry points: asks the
 * model for structured output, then converts and validates it against
 * InvoiceSchema (shape only). Business rules are checked later by @invariant/rules.
 */
export async function extractWithModel(
  prompt: ExtractionPrompt,
  model: LanguageModel,
  promptVersion: string,
): Promise<ExtractionResult> {
  const result = await generateText({
    model,
    ...(prompt.instructions === undefined
      ? {}
      : { instructions: prompt.instructions }),
    messages: prompt.messages,
    output: Output.object({ schema: ModelInvoiceSchema, name: "invoice" }),
  });

  return {
    invoice: toInvoice(result.output),
    promptVersion,
    usage: {
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
    },
  };
}
