import {
  type ExtractionScore,
  SCORED_FIELDS,
  type ScoredField,
} from "./score.js";

/** One document of an eval run: its score plus what the extraction cost. */
export type DocumentResult = {
  id: string;
  score: ExtractionScore;
  usage: { inputTokens: number | undefined; outputTokens: number | undefined };
  latencyMs: number;
  /** Set when the extraction threw; the score then mismatches every field. */
  error?: string;
};

export type Summary = {
  documents: number;
  /** Share of documents whose field matches the label, from 0 to 1. */
  fieldAccuracy: Record<ScoredField, number>;
  exactMatchRate: number;
  /** Share of documents whose extraction passes the business rules. */
  rulePassRate: number;
  /** Extractions that threw an error. */
  failures: number;
  inputTokens: number;
  outputTokens: number;
  medianLatencyMs: number;
};

/** Share of items that satisfy the predicate; 0 for an empty list. */
function rate<T>(items: readonly T[], predicate: (item: T) => boolean): number {
  return items.length === 0 ? 0 : items.filter(predicate).length / items.length;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

/** Aggregates the per-document results of a run. Failed extractions count as documents. */
export function summarize(results: readonly DocumentResult[]): Summary {
  const fieldAccuracy = Object.fromEntries(
    SCORED_FIELDS.map((field) => [
      field,
      rate(results, (r) => r.score.fields[field].match),
    ]),
  ) as Record<ScoredField, number>;

  return {
    documents: results.length,
    fieldAccuracy,
    exactMatchRate: rate(results, (r) => r.score.exactMatch),
    rulePassRate: rate(results, (r) => r.score.rules.valid),
    failures: results.filter((r) => r.error !== undefined).length,
    inputTokens: results.reduce(
      (sum, r) => sum + (r.usage.inputTokens ?? 0),
      0,
    ),
    outputTokens: results.reduce(
      (sum, r) => sum + (r.usage.outputTokens ?? 0),
      0,
    ),
    medianLatencyMs: median(results.map((r) => r.latencyMs)),
  };
}
