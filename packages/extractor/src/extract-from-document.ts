import type { LanguageModel } from "ai";
import {
  type ExtractionOptions,
  type ExtractionResult,
  extractWithModel,
} from "./extract-with-model.js";
import {
  EXTRACT_DOCUMENT_INSTRUCTIONS,
  EXTRACT_DOCUMENT_PROMPT_VERSION,
} from "./prompts/extract-document-v2.js";

/** Media types a vision-capable model can read as an invoice document. */
export const SUPPORTED_MEDIA_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

/** An invoice document as raw bytes plus its media type (e.g. "application/pdf"). */
export interface Document {
  bytes: Uint8Array;
  mediaType: string;
}

/** Thrown before any model call when a document cannot be sent to the model. */
export class UnsupportedDocumentError extends Error {
  override name = "UnsupportedDocumentError";
}

export function assertSupported(document: Document): void {
  if (
    !(SUPPORTED_MEDIA_TYPES as readonly string[]).includes(document.mediaType)
  )
    throw new UnsupportedDocumentError(
      `Unsupported media type "${document.mediaType}". Supported: ${SUPPORTED_MEDIA_TYPES.join(", ")}.`,
    );
  if (document.bytes.length === 0)
    throw new UnsupportedDocumentError("The document is empty (0 bytes).");
}

/**
 * Extracts an invoice from a PDF or image using a vision-capable model.
 *
 * The document goes to the model as a `file` part with its media type
 * unchanged, so the provider decides whether to send it as a file or an image.
 * Unsupported or empty documents are rejected before any model call.
 * `options.instructions` replaces the prompt text (see ExtractionOptions).
 */
export async function extractInvoiceFromDocument(
  document: Document,
  model: LanguageModel,
  options: ExtractionOptions = {},
): Promise<ExtractionResult> {
  assertSupported(document);

  return extractWithModel(
    {
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: options.instructions ?? EXTRACT_DOCUMENT_INSTRUCTIONS,
            },
            {
              type: "file",
              mediaType: document.mediaType,
              data: document.bytes,
            },
          ],
        },
      ],
    },
    model,
    EXTRACT_DOCUMENT_PROMPT_VERSION,
  );
}
