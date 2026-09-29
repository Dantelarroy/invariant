import type { Invoice } from "@invariant/schema";
import type { DatasetItem } from "./dataset.js";
import { scoreExtraction } from "./score.js";
import type { DocumentResult } from "./summarize.js";

/** What an extractor returns for one document; it throws when extraction fails. */
export type Extract = (item: DatasetItem) => Promise<{
  invoice: Invoice;
  usage: { inputTokens: number | undefined; outputTokens: number | undefined };
}>;

/**
 * Extracts and scores documents one at a time, in order. A failed extraction
 * is recorded with its error and scored as a mismatch; the run keeps going.
 */
export async function evaluateDocuments(
  items: readonly DatasetItem[],
  extract: Extract,
  options: { today: string; onResult?: (result: DocumentResult) => void },
): Promise<DocumentResult[]> {
  const results: DocumentResult[] = [];
  for (const item of items) {
    const started = performance.now();
    let result: DocumentResult;
    try {
      const { invoice, usage } = await extract(item);
      result = {
        id: item.id,
        score: scoreExtraction(item.invoice, invoice, { today: options.today }),
        usage,
        latencyMs: Math.round(performance.now() - started),
      };
    } catch (error) {
      result = {
        id: item.id,
        score: scoreExtraction(item.invoice, null, { today: options.today }),
        usage: { inputTokens: undefined, outputTokens: undefined },
        latencyMs: Math.round(performance.now() - started),
        error: error instanceof Error ? error.message : String(error),
      };
    }
    results.push(result);
    options.onResult?.(result);
  }
  return results;
}
