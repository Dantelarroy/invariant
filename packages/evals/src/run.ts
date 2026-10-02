import { shouldUseRepair } from "@invariant/extractor";
import {
  type VerificationResult,
  type Violation,
  verifyInvoice,
} from "@invariant/rules";
import type { Invoice } from "@invariant/schema";
import type { DatasetItem, DocumentItem } from "./dataset.js";
import {
  type ExtractionScore,
  type RuleScore,
  scoreExtraction,
  scoreRules,
} from "./score.js";
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
export type Extract = (item: DocumentItem) => Promise<Extraction>;

/**
 * Extracts the document once more given the first extraction's violations
 * (ADR-0010); it throws when the repair fails.
 */
export type Repair = (
  item: DocumentItem,
  issues: readonly Violation[],
) => Promise<Extraction>;

/**
 * Optional tracing hooks (ADR-0011): one trace per document, with a
 * generation per model call, scored with its rule results (ADR-0012). The
 * runner behaves the same without them.
 */
export interface DocumentTracer {
  startDocument(item: DocumentItem): DocumentTrace;
}
export interface DocumentTrace {
  /** Runs one model call inside a generation; must return or rethrow what `call` does. */
  generation<T extends Extraction>(
    kind: "extract" | "repair",
    call: () => Promise<T>,
  ): Promise<T>;
  /** The rule results of the last generation of that kind. */
  verified(kind: "extract" | "repair", verification: VerificationResult): void;
  end(result: DocumentResult<RuleScore>): void;
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
 *
 * Unlabeled documents (no `invoice`) are extracted, verified, repaired and
 * traced the same way, but scored on their rules only (a RuleScore).
 */
export function evaluateDocuments(
  items: readonly DatasetItem[],
  extract: Extract,
  options: EvaluateOptions<ExtractionScore>,
): Promise<DocumentResult[]>;
export function evaluateDocuments(
  items: readonly DocumentItem[],
  extract: Extract,
  options: EvaluateOptions<RuleScore>,
): Promise<DocumentResult<RuleScore>[]>;
export async function evaluateDocuments(
  items: readonly DocumentItem[],
  extract: Extract,
  options: EvaluateOptions<RuleScore>,
): Promise<DocumentResult<RuleScore>[]> {
  const { today } = options;
  const results: DocumentResult<RuleScore>[] = [];
  for (const item of items) {
    // With a label, every field is compared too; without one, only the rules.
    const scoreOf = (actual: Invoice | null): RuleScore =>
      item.invoice
        ? scoreExtraction(item.invoice, actual, { today })
        : scoreRules(actual, { today });
    const started = performance.now();
    const elapsed = () => Math.round(performance.now() - started);
    const trace = options.tracer?.startDocument(item);
    const traced: Traced = (kind, call) =>
      trace ? trace.generation(kind, call) : call();
    let result: DocumentResult<RuleScore>;
    try {
      const { invoice, usage } = await traced("extract", () => extract(item));
      trace?.verified("extract", verifyInvoice(invoice, { today }));
      const score = scoreOf(invoice);
      result = { id: item.id, score, usage, latencyMs: elapsed() };
      if (options.repair) {
        result = await repairOnce(item, invoice, result, options.repair, {
          today,
          scoreOf,
          elapsed,
          ...(trace ? { trace } : {}),
          traced,
        });
      }
    } catch (error) {
      const score = scoreOf(null);
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

type EvaluateOptions<S extends RuleScore> = {
  today: string;
  // Method syntax: a labeled run's callback also fits the implementation's.
  onResult?(result: DocumentResult<S>): void;
  repair?: Repair;
  tracer?: DocumentTracer;
};

async function repairOnce(
  item: DocumentItem,
  invoice: Invoice,
  first: DocumentResult<RuleScore>,
  repair: Repair,
  {
    today,
    scoreOf,
    elapsed,
    traced,
    trace,
  }: {
    today: string;
    scoreOf: (actual: Invoice | null) => RuleScore;
    elapsed: () => number;
    traced: Traced;
    trace?: DocumentTrace;
  },
): Promise<DocumentResult<RuleScore>> {
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
    const verification = verifyInvoice(repaired.invoice, { today });
    trace?.verified("repair", verification);
    const repairedErrors = errorCount(verification.violations);
    const used = shouldUseRepair(errorCount(violations), repairedErrors);
    return {
      ...first,
      score: used ? scoreOf(repaired.invoice) : first.score,
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
