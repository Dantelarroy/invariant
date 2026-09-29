import type { Invoice } from "@invariant/schema";
import { describe, expect, it } from "vitest";
import { scoreExtraction } from "./score.js";
import { type DocumentResult, summarize } from "./summarize.js";

const TODAY = "2026-09-29";

const label: Invoice = {
  number: "F-1",
  issueDate: "2026-09-24",
  currency: "EUR",
  supplier: { name: "Proveedor SL", taxId: "B12345674" },
  customer: { name: "Cliente SL" },
  lines: [
    {
      description: "Item",
      quantity: 1,
      unitPriceCents: 1000,
      lineTotalCents: 1000,
      vatRateBps: 2100,
    },
  ],
  taxBaseCents: 1000,
  vatAmountCents: 210,
  totalCents: 1210,
};

function result(
  id: string,
  actual: Invoice | null,
  extra: Partial<DocumentResult> = {},
): DocumentResult {
  return {
    id,
    score: scoreExtraction(label, actual, { today: TODAY }),
    usage: { inputTokens: 1000, outputTokens: 100 },
    latencyMs: 2000,
    ...extra,
  };
}

describe("summarize", () => {
  const results: DocumentResult[] = [
    // Perfect.
    result("a", label, { latencyMs: 1000 }),
    // Total off by one cent: breaks the "total" rule.
    result("b", { ...label, totalCents: 1211 }, { latencyMs: 3000 }),
    // Wrong but consistent: base, VAT and total mismatch, rules pass.
    result(
      "c",
      {
        ...label,
        lines: label.lines.map((line) => ({
          ...line,
          unitPriceCents: 2000,
          lineTotalCents: 2000,
        })),
        taxBaseCents: 2000,
        vatAmountCents: 420,
        totalCents: 2420,
      },
      { latencyMs: 2000, usage: { inputTokens: 1200, outputTokens: 150 } },
    ),
    // Failed extraction: the model call threw.
    result("d", null, {
      latencyMs: 500,
      usage: { inputTokens: undefined, outputTokens: undefined },
      error: "timeout",
    }),
  ];

  it("counts documents and failed extractions", () => {
    const summary = summarize(results);

    expect(summary.documents).toBe(4);
    expect(summary.failures).toBe(1);
  });

  it("computes per-field accuracy over every document, failures included", () => {
    const { fieldAccuracy } = summarize(results);

    expect(fieldAccuracy.number).toBe(0.75);
    expect(fieldAccuracy.lineCount).toBe(0.75);
    expect(fieldAccuracy.totalCents).toBe(0.25);
    expect(fieldAccuracy.taxBaseCents).toBe(0.5);
  });

  it("computes the exact-match rate and the rule pass rate", () => {
    const summary = summarize(results);

    expect(summary.exactMatchRate).toBe(0.25);
    expect(summary.rulePassRate).toBe(0.5);
  });

  it("adds up tokens, ignoring documents with no reported usage", () => {
    const summary = summarize(results);

    expect(summary.inputTokens).toBe(3200);
    expect(summary.outputTokens).toBe(350);
  });

  it("reports the median latency, averaging the two middle values for an even count", () => {
    expect(summarize(results).medianLatencyMs).toBe(1500);
    expect(summarize(results.slice(0, 3)).medianLatencyMs).toBe(2000);
  });

  it("returns zeros for an empty run instead of dividing by zero", () => {
    const summary = summarize([]);

    expect(summary.documents).toBe(0);
    expect(summary.exactMatchRate).toBe(0);
    expect(summary.rulePassRate).toBe(0);
    expect(summary.fieldAccuracy.totalCents).toBe(0);
    expect(summary.medianLatencyMs).toBe(0);
  });
});
