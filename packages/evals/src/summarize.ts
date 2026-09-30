import {
  type ExtractionScore,
  SCORED_FIELDS,
  type ScoredField,
} from "./score.js";

export type Usage = {
  inputTokens: number | undefined;
  outputTokens: number | undefined;
};

/** One document of an eval run: its score plus what the extraction cost. */
export type DocumentResult = {
  id: string;
  /** With repair, the score of the extraction that was kept. */
  score: ExtractionScore;
  /** With repair, extraction and repair tokens added up. */
  usage: Usage;
  latencyMs: number;
  /** Set when the extraction threw; the score then mismatches every field. */
  error?: string;
  /** Only in runs with repair (ADR-0010): what happened before and during it. */
  repair?: {
    /** True when the first extraction had rule errors and a repair was requested. */
    attempted: boolean;
    /** True when the repaired extraction was kept (it had fewer errors). */
    used: boolean;
    scoreBefore: ExtractionScore;
    usageBefore: Usage;
    latencyMsBefore: number;
    /** Set when the repair call threw; the first extraction is kept. */
    error?: string;
  };
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

export type RepairSummary = {
  /** The first extractions, as if there were no repair. */
  before: Summary;
  /** The extractions that were kept after repair. */
  after: Summary;
  repairsAttempted: number;
  repairsUsed: number;
};

/** Before and after summaries of a run with repair (ADR-0010). */
export function summarizeRepair(
  results: readonly DocumentResult[],
): RepairSummary {
  const firstAttempts = results.map((r) =>
    r.repair
      ? {
          ...r,
          score: r.repair.scoreBefore,
          usage: r.repair.usageBefore,
          latencyMs: r.repair.latencyMsBefore,
        }
      : r,
  );
  return {
    before: summarize(firstAttempts),
    after: summarize(results),
    repairsAttempted: results.filter((r) => r.repair?.attempted).length,
    repairsUsed: results.filter((r) => r.repair?.used).length,
  };
}
