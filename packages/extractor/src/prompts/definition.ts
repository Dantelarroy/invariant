/**
 * A prompt version defined in code. Git is the source of truth: the Langfuse
 * prompt registry holds a copy under the family `name`, where Langfuse version
 * N is our `<name>-vN` (ADR-0012).
 */
export interface PromptDefinition {
  /** The family, e.g. "extract-document". */
  readonly name: string;
  /** 1, 2, ...: a new wording is a new version, never an edit. */
  readonly version: number;
  /** The instructions sent to the model. */
  readonly text: string;
}

/** Our id for a prompt version, as stored with invoices and in eval reports. */
export function promptId(prompt: PromptDefinition): string {
  return `${prompt.name}-v${prompt.version}`;
}
