/**
 * The cost and latency report (ADR-0011), computed locally from observations
 * read back from Langfuse. Pure: the CLI fetches, this aggregates.
 */

/** The fields of a Langfuse v2 observation the report reads. */
export interface ReportObservation {
  traceId: string;
  type: string;
  name: string;
  startTime: string;
  /** Seconds, as Langfuse reports it; null while the observation is open. */
  latency: number | null;
  isRootObservation: boolean;
  model?: string | null;
  /** US dollars, computed by Langfuse from model and usage; null without usage. */
  totalCost?: number | null;
  metadata?: unknown;
}

export interface ReportGroup {
  key: string;
  traces: number;
  generations: number;
  /** Integer micro-dollars, so sums of small costs stay exact. */
  costMicroUsd: number;
  /** Nearest-rank percentiles of the latency of the traces in the group. */
  p50Ms: number;
  p95Ms: number;
}

export interface Report {
  traces: number;
  generations: number;
  generationsWithoutCost: number;
  totalCostMicroUsd: number;
  byModel: ReportGroup[];
  byPromptVersion: ReportGroup[];
  byBranch: ReportGroup[];
}

/** Traces without a branch (eval traces) are grouped under this key. */
const NO_BRANCH = "(none)";

/** The value at rank ceil(p/100 × n) of the sorted values, without interpolation. */
export function nearestRank(
  values: readonly number[],
  p: number,
): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1];
}

const toMicroUsd = (usd: number | null | undefined) =>
  typeof usd === "number" ? Math.round(usd * 1_000_000) : 0;

function metadataOf(observation: ReportObservation): Record<string, unknown> {
  const { metadata } = observation;
  return typeof metadata === "object" && metadata !== null
    ? (metadata as Record<string, unknown>)
    : {};
}

/** A workflow run (the root, or a resumed run nested in the same trace) or an eval root. */
function isRun(observation: ReportObservation): boolean {
  return (
    observation.isRootObservation ||
    metadataOf(observation).spanType === "workflow_run"
  );
}

interface TraceSummary {
  latencyMs: number;
  branch: string;
  generations: ReportObservation[];
}

function traceSummaries(
  observations: readonly ReportObservation[],
): Map<string, TraceSummary> {
  const traces = new Map<string, TraceSummary>();
  const lastRunStart = new Map<string, string>();
  const summaryOf = (traceId: string) => {
    let summary = traces.get(traceId);
    if (!summary) {
      summary = { latencyMs: 0, branch: NO_BRANCH, generations: [] };
      traces.set(traceId, summary);
    }
    return summary;
  };
  for (const observation of observations) {
    if (observation.type === "GENERATION") {
      summaryOf(observation.traceId).generations.push(observation);
    }
    if (!isRun(observation)) continue;
    const summary = summaryOf(observation.traceId);
    // A resumed run adds its own time; the time spent waiting for a person does not count.
    summary.latencyMs += Math.round((observation.latency ?? 0) * 1000);
    const branch = metadataOf(observation).branch;
    const previous = lastRunStart.get(observation.traceId);
    if (
      typeof branch === "string" &&
      (previous === undefined || observation.startTime >= previous)
    ) {
      summary.branch = branch;
      lastRunStart.set(observation.traceId, observation.startTime);
    }
  }
  return traces;
}

function group(
  traces: Map<string, TraceSummary>,
  keysOf: (trace: TraceSummary) => Map<string, ReportObservation[]>,
): ReportGroup[] {
  const groups = new Map<
    string,
    { latencies: number[]; generations: ReportObservation[] }
  >();
  for (const trace of traces.values()) {
    for (const [key, generations] of keysOf(trace)) {
      const entry = groups.get(key) ?? { latencies: [], generations: [] };
      entry.latencies.push(trace.latencyMs);
      entry.generations.push(...generations);
      groups.set(key, entry);
    }
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, { latencies, generations }]) => ({
      key,
      traces: latencies.length,
      generations: generations.length,
      costMicroUsd: generations.reduce(
        (sum, g) => sum + toMicroUsd(g.totalCost),
        0,
      ),
      p50Ms: nearestRank(latencies, 50) ?? 0,
      p95Ms: nearestRank(latencies, 95) ?? 0,
    }));
}

function byGeneration(
  field: (generation: ReportObservation) => string,
): (trace: TraceSummary) => Map<string, ReportObservation[]> {
  return (trace) => {
    const keys = new Map<string, ReportObservation[]>();
    for (const generation of trace.generations) {
      const key = field(generation);
      keys.set(key, [...(keys.get(key) ?? []), generation]);
    }
    return keys;
  };
}

/**
 * Counts, total cost and nearest-rank p50/p95 trace latency per model, per
 * prompt version (generation name) and per branch. A trace's latency is the
 * sum of its runs; its branch is the one its last run set.
 */
export function summarizeObservations(
  observations: readonly ReportObservation[],
): Report {
  const traces = traceSummaries(observations);
  const generations = [...traces.values()].flatMap((t) => t.generations);
  return {
    traces: traces.size,
    generations: generations.length,
    generationsWithoutCost: generations.filter(
      (g) => typeof g.totalCost !== "number",
    ).length,
    totalCostMicroUsd: generations.reduce(
      (sum, g) => sum + toMicroUsd(g.totalCost),
      0,
    ),
    byModel: group(
      traces,
      byGeneration((g) => g.model || "(unknown)"),
    ),
    byPromptVersion: group(
      traces,
      byGeneration((g) => g.name),
    ),
    byBranch: group(
      traces,
      (trace) => new Map([[trace.branch, trace.generations]]),
    ),
  };
}

const usd = (microUsd: number) => `$${(microUsd / 1_000_000).toFixed(4)}`;

function formatGroups(title: string, groups: readonly ReportGroup[]): string {
  const rows = [
    [title, "traces", "calls", "cost", "p50", "p95"],
    ...groups.map((g) => [
      g.key,
      String(g.traces),
      String(g.generations),
      usd(g.costMicroUsd),
      `${g.p50Ms} ms`,
      `${g.p95Ms} ms`,
    ]),
  ];
  const widths =
    rows[0]?.map((_, column) =>
      Math.max(...rows.map((row) => row[column]?.length ?? 0)),
    ) ?? [];
  return rows
    .map((row) =>
      row
        .map((cell, column) =>
          column === 0
            ? cell.padEnd(widths[column] ?? 0)
            : cell.padStart(widths[column] ?? 0),
        )
        .join("  "),
    )
    .join("\n");
}

/** The report as aligned plain-text tables. Latency is trace latency. */
export function formatReport(report: Report): string {
  return [
    `traces        ${report.traces}`,
    `model calls   ${report.generations}${report.generationsWithoutCost ? ` (${report.generationsWithoutCost} without cost)` : ""}`,
    `total cost    ${usd(report.totalCostMicroUsd)}`,
    "",
    formatGroups("model", report.byModel),
    "",
    formatGroups("prompt version", report.byPromptVersion),
    "",
    formatGroups("branch", report.byBranch),
  ].join("\n");
}
