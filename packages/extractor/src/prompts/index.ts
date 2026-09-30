import type { PromptDefinition } from "./definition.js";
import { EXTRACT_DOCUMENT_PROMPT as EXTRACT_DOCUMENT_V1 } from "./extract-document-v1.js";
import { EXTRACT_DOCUMENT_PROMPT as EXTRACT_DOCUMENT_V2 } from "./extract-document-v2.js";
import { EXTRACT_TEXT_PROMPT } from "./extract-text-v1.js";
import { REPAIR_PROMPT } from "./repair-v1.js";

/**
 * Every prompt version defined in code, superseded ones included, in the
 * order they are seeded into the Langfuse prompt registry (each family in
 * version order, ADR-0012).
 */
export const PROMPTS: readonly PromptDefinition[] = [
  EXTRACT_TEXT_PROMPT,
  EXTRACT_DOCUMENT_V1,
  EXTRACT_DOCUMENT_V2,
  REPAIR_PROMPT,
];
