import { shouldUseRepair } from "@invariant/extractor";
import { type Violation, verifyInvoice } from "@invariant/rules";
import type { Invoice } from "@invariant/schema";
import type { DatasetItem } from "./dataset.js";
import { scoreExtraction } from "./score.js";
import type { DocumentResult, Usage } from "./summarize.js";

/**
 * What one model call returns. `modelId` and `promptVersion` are optional and
 * only feed tracing; the extractor's ExtractionResult carries both.
 */
export type Extraction = {
  invoice: Invoice;
  usage: Usage;
  modelId?: string;
  promptVersion?: string;
};

/** What an extractor returns for one document; it throws when extraction fails. */
export type Extract = (item: DatasetItem) => Promise<Extraction>;

/**
 * Extracts the document once more given the first extraction's violations
 * (ADR-0010); it throws when the repair fails.
 */
export type Repair = (
  item: DatasetItem,
  issues: readonly Violation[],
) => Promise<Extraction>;

/**
 * Optional tracing hooks (ADR-0011): one trace per document, with a
 * generation per model call. The runner behaves the same without them.
 */
export interface DocumentTracer {
  startDocument(item: DatasetItem): DocumentTrace;
}
export interface DocumentTrace {
  /** Runs one model call inside a generation; must return or rethrow what `call` does. */
  generation<T extends Extraction>(
    kind: "extract" | "repair",
    call: () => Promise<T>,
  ): Promise<T>;
  end(result: DocumentResult): void;
}

type Traced = <T extends Extraction>(
  kind: "extract" | "repair",
  call: () => Promise<T>,
) => Promise<T>;

const errorCount = (violations: readonly Violation[]) =>
  violations.filter((v) => v.severity === "error").length;

const addUsage = (a: Usage, b: Usage): Usage => ({
  inputTokens: (a.inputTokens ?? 0) + (b.inputTokens ?? 0),
  outputTokens: (a.outputTokens ?? 0) + (b.outputTokens ?? 0),
});

/**
 * Extracts and scores documents one at a time, in order. A failed extraction
 * is recorded with its error and scored as a mismatch; the run keeps going.
 *
 * With `repair`, every extraction with rule errors is repaired once and the
 * better one is kept, as the workflow does (ADR-0010). `score` is then the
 * chosen extraction's and `repair` records the score before repairing.
 */
export async function evaluateDocuments(
  items: readonly DatasetItem[],
  extract: Extract,
  options: {
    today: string;
    onResult?: (result: DocumentResult) => void;
    repair?: Repair;
    tracer?: DocumentTracer;
  },
): Promise<DocumentResult[]> {
  const { today } = options;
  const results: DocumentResult[] = [];
  for (const item of items) {
    const started = performance.now();
    const elapsed = () => Math.round(performance.now() - started);
    const trace = options.tracer?.startDocument(item);
    const traced: Traced = (kind, call) =>
      trace ? trace.generation(kind, call) : call();
    let result: DocumentResult;
    try {
      const { invoice, usage } = await traced("extract", () => extract(item));
      const score = scoreExtraction(item.invoice, invoice, { today });
      result = { id: item.id, score, usage, latencyMs: elapsed() };
      if (options.repair) {
        result = await repairOnce(item, invoice, result, options.repair, {
          today,
          elapsed,
          traced,
        });
      }
    } catch (error) {
      const score = scoreExtraction(item.invoice, null, { today });
      const usage = { inputTokens: undefined, outputTokens: undefined };
      result = {
        id: item.id,
        score,
        usage,
        latencyMs: elapsed(),
        error: error instanceof Error ? error.message : String(error),
      };
      if (options.repair) {
        result.repair = {
          attempted: false,
          used: false,
          scoreBefore: score,
          usageBefore: usage,
          latencyMsBefore: result.latencyMs,
        };
      }
    }
    results.push(result);
    trace?.end(result);
    options.onResult?.(result);
  }
  return results;
}

async function repairOnce(
  item: DatasetItem,
  invoice: Invoice,
  first: DocumentResult,
  repair: Repair,
  {
    today,
    elapsed,
    traced,
  }: { today: string; elapsed: () => number; traced: Traced },
): Promise<DocumentResult> {
  const before = {
    scoreBefore: first.score,
    usageBefore: first.usage,
    latencyMsBefore: first.latencyMs,
  };
  const { violations } = verifyInvoice(invoice, { today });
  if (errorCount(violations) === 0) {
    return { ...first, repair: { attempted: false, used: false, ...before } };
  }
  try {
    const repaired = await traced("repair", () => repair(item, violations));
    const repairedErrors = errorCount(
      verifyInvoice(repaired.invoice, { today }).violations,
    );
    const used = shouldUseRepair(errorCount(violations), repairedErrors);
    return {
      ...first,
      score: used
        ? scoreExtraction(item.invoice, repaired.invoice, { today })
        : first.score,
      usage: addUsage(first.usage, repaired.usage),
      latencyMs: elapsed(),
      repair: { attempted: true, used, ...before },
    };
  } catch (error) {
    return {
      ...first,
      latencyMs: elapsed(),
      repair: {
        attempted: true,
        used: false,
        ...before,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
