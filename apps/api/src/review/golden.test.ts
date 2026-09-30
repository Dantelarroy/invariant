import type { CompletedReview } from "@invariant/observability";
import type { Invoice } from "@invariant/schema";
import { describe, expect, it } from "vitest";
import { type GoldenRecord, mergeGolden } from "./golden.js";

const invoice: Invoice = {
  number: "F-1",
  issueDate: "2026-09-22",
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
  totalCents: 1310,
};

function review(
  n: number,
  overrides: Partial<CompletedReview> = {},
): CompletedReview {
  return {
    itemId: `item-${n}`,
    observationId: `obs-${n}`,
    completedAt: `2026-09-30T13:0${n}:00.000Z`,
    verdict: "correct",
    reviewer: "user-1",
    correction: undefined,
    generation: {
      traceId: `trace-${n}`,
      runId: `run-${n}`,
      documentId: `doc-${n}`,
      promptVersion: "extract-text-v1",
      source: `text ${n}`,
      output: invoice,
    },
    ...overrides,
  };
}

describe("mergeGolden", () => {
  it("writes one record per correct or corrected review, with the confirmed invoice", () => {
    const corrected = { ...invoice, totalCents: 1210 };
    const { records, skipped } = mergeGolden(
      [],
      [
        review(2, {
          verdict: "corrected",
          correction: JSON.stringify(corrected),
        }),
        review(1),
        review(3, { verdict: "unusable" }),
      ],
    );

    expect(skipped).toEqual([]);
    expect(records).toEqual([
      {
        id: "golden-doc-1",
        documentId: "doc-1",
        verdict: "correct",
        invoice,
        text: "text 1",
        traceId: "trace-1",
        observationId: "obs-1",
        promptVersion: "extract-text-v1",
        reviewedAt: "2026-09-30T13:01:00.000Z",
        source: "langfuse-review",
      },
      expect.objectContaining({
        documentId: "doc-2",
        verdict: "corrected",
        invoice: corrected,
      }),
    ]);
  });

  it("upserts by document id: exporting again changes nothing, a new review replaces the old one", () => {
    const first = mergeGolden([], [review(1), review(2)]).records;
    expect(mergeGolden(first, [review(1), review(2)]).records).toEqual(first);

    const fixed = { ...invoice, number: "F-1b" };
    const { records } = mergeGolden(first, [
      review(1, { verdict: "corrected", correction: JSON.stringify(fixed) }),
    ]);
    expect(records).toHaveLength(2);
    expect(records[0]).toMatchObject({ documentId: "doc-1", invoice: fixed });
  });

  it("keeps records whose review is no longer listed, and drops one later marked unusable", () => {
    const first = mergeGolden([], [review(1), review(2)]).records;
    const { records } = mergeGolden(first, [
      review(2, { verdict: "unusable" }),
    ]);
    expect(records.map((r: GoldenRecord) => r.documentId)).toEqual(["doc-1"]);
  });

  it("keeps an invoice that breaks the rules: the golden set is as printed", () => {
    // 1000 + 210 is not 1310, and the record is still written.
    const { records } = mergeGolden([], [review(1)]);
    expect(records[0]?.invoice.totalCents).toBe(1310);
  });

  it("skips reviews without a verdict, an invalid correction or a readable generation, saying why", () => {
    const { records, skipped } = mergeGolden(
      [],
      [
        review(1, { verdict: undefined }),
        review(2, { verdict: "corrected", correction: '{"totalCents": 12.5}' }),
        review(3, { generation: undefined }),
        review(4, {
          generation: { ...review(4).generation, output: { nope: 1 } } as never,
        }),
      ],
    );
    expect(records).toEqual([]);
    expect(skipped.map((s) => s.itemId)).toEqual([
      "item-1",
      "item-2",
      "item-3",
      "item-4",
    ]);
    expect(skipped[1]?.reason).toContain("not a valid invoice");
  });

  it("sorts records by document id so diffs are stable", () => {
    const { records } = mergeGolden([], [review(3), review(1), review(2)]);
    expect(records.map((r) => r.documentId)).toEqual([
      "doc-1",
      "doc-2",
      "doc-3",
    ]);
  });
});
