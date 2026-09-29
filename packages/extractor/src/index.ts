export {
  type Document,
  extractInvoiceFromDocument,
  SUPPORTED_MEDIA_TYPES,
  UnsupportedDocumentError,
} from "./extract-from-document.js";
export { extractInvoiceFromText } from "./extract-from-text.js";
export type { ExtractionResult } from "./extract-with-model.js";
export { EXTRACT_DOCUMENT_PROMPT_VERSION } from "./prompts/extract-document-v1.js";
