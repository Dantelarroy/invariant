import { describe, expect, it } from "vitest";
import {
  formatReport,
  nearestRank,
  type ReportObservation,
  summarizeObservations,
} from "./index.js";

describe("nearestRank", () => {
  it("picks the value at rank ceil(p × n), without interpolation", () => {
    const values = [10, 1, 9, 2, 8, 3, 7, 4, 6, 5];
    expect(nearestRank(values, 50)).toBe(5);
    expect(nearestRank(values, 95)).toBe(10);
    expect(nearestRank([4, 1, 3, 2], 50)).toBe(2);
    expect(nearestRank([42], 95)).toBe(42);
  });

  it("is undefined for no values", () => {
    expect(nearestRank([], 50)).toBeUndefined();
  });
});

const root = (
  traceId: string,
  latency: number,
  metadata: Record<string, unknown> = {},
): ReportObservation => ({
  traceId,
  type: "SPAN",
  name: traceId,
  startTime: "2026-09-30T10:00:00.000Z",
  latency,
  isRootObservation: true,
  metadata,
});

const generation = (
  traceId: string,
  name: string,
  model: string,
  totalCost: number | null,
): ReportObservation => ({
  traceId,
  type: "GENERATION",
  name,
  startTime: "2026-09-30T10:00:01.000Z",
  latency: 1,
  isRootObservation: false,
  model,
  totalCost,
});

describe("summarizeObservations", () => {
  const MINI = "gpt-5-mini-2025-08-07";

  it("counts traces and adds up the cost Langfuse computed", () => {
    const report = summarizeObservations([
      root("t1", 10),
      generation("t1", "extract-document-v2", MINI, 0.002),
      root("t2", 20),
      generation("t2", "extract-document-v2", MINI, 0.003),
      generation("t2", "repair-v1", MINI, 0.001),
      root("t3", 30),
      // A failed call has no usage, so Langfuse computes no cost.
      generation("t3", "extract-document-v2", MINI, null),
    ]);

    expect(report.traces).toBe(3);
    expect(report.generations).toBe(4);
    expect(report.generationsWithoutCost).toBe(1);
    // Summed in integer micro-dollars, so 0.002 + 0.003 + 0.001 is exact.
    expect(report.totalCostMicroUsd).toBe(6000);
  });

  it("reports nearest-rank p50/p95 trace latency per model, prompt version and branch", () => {
    const report = summarizeObservations([
      root("t1", 10),
      generation("t1", "extract-document-v2", MINI, 0.002),
      root("t2", 20),
      generation("t2", "extract-document-v2", MINI, 0.003),
      generation("t2", "repair-v1", MINI, 0.001),
      root("t3", 30),
      generation("t3", "extract-document-v2", "gpt-5-2025-08-07", 0.01),
    ]);

    expect(report.byModel).toEqual([
      {
        key: "gpt-5-2025-08-07",
        traces: 1,
        generations: 1,
        costMicroUsd: 10000,
        p50Ms: 30000,
        p95Ms: 30000,
      },
      {
        key: MINI,
        traces: 2,
        generations: 3,
        costMicroUsd: 6000,
        p50Ms: 10000,
        p95Ms: 20000,
      },
    ]);
    expect(report.byPromptVersion.map((g) => [g.key, g.traces])).toEqual([
      ["extract-document-v2", 3],
      ["repair-v1", 1],
    ]);
    expect(report.byBranch).toEqual([
      {
        key: "(none)",
        traces: 3,
        generations: 4,
        costMicroUsd: 16000,
        p50Ms: 20000,
        p95Ms: 30000,
      },
    ]);
  });

  it("takes a resumed trace's branch from its last run and adds up its runs' latency", () => {
    const report = summarizeObservations([
      root("p1", 5, { branch: "needs_review", spanType: "workflow_run" }),
      generation("p1", "extract-text-v1", "gpt-5-mini-2025-08-07", 0.001),
      {
        // The resumed run: a nested workflow run in the same trace.
        traceId: "p1",
        type: "SPAN",
        name: "invoke_workflow process-document",
        startTime: "2026-09-30T11:00:00.000Z",
        latency: 1,
        isRootObservation: false,
        metadata: { branch: "accepted", spanType: "workflow_run" },
      },
      root("p2", 2, { branch: "duplicate", spanType: "workflow_run" }),
    ]);

    expect(report.traces).toBe(2);
    expect(report.byBranch.map((g) => [g.key, g.traces, g.p50Ms])).toEqual([
      ["accepted", 1, 6000],
      ["duplicate", 1, 2000],
    ]);
  });
});

describe("formatReport", () => {
  it("prints the counts, the total cost and one table per grouping", () => {
    const text = formatReport(
      summarizeObservations([
        root("t1", 12.5),
        generation("t1", "extract-document-v2", "gpt-5-mini", 0.0021),
      ]),
    );

    expect(text).toContain("traces        1");
    expect(text).toContain("total cost    $0.0021");
    expect(text).toContain("model");
    expect(text).toContain("prompt version");
    expect(text).toContain("branch");
    expect(text).toContain("12500 ms");
  });
});
