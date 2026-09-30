import type { CompletedReview } from "@invariant/observability";
import type { Invoice } from "@invariant/schema";
import { describe, expect, it } from "vitest";
import { planSync } from "./sync.js";

const invoice: Invoice = {
  number: "DL-2026-0317",
  issueDate: "2026-09-22",
  currency: "EUR",
  supplier: { name: "Distribuciones Levante S.L.", taxId: "B46123451" },
  customer: { name: "Restaurante Sol", taxId: "B87654323" },
  lines: [
    {
      description: "Servilletas",
      quantity: 1,
      unitPriceCents: 8500,
      lineTotalCents: 8500,
      vatRateBps: 2100,
    },
  ],
  taxBaseCents: 8500,
  vatAmountCents: 1785,
  totalCents: 11285,
};

function review(
  n: number,
  overrides: Partial<CompletedReview> = {},
): CompletedReview {
  return {
    itemId: `item-${n}`,
    observationId: `obs-${n}`,
    completedAt: "2026-09-30T13:00:00Z",
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

const paused = (ids: string[]) =>
  new Map(ids.map((id) => [id, "needs_review" as const]));

describe("planSync", () => {
  it("approves a correct review as extracted", () => {
    expect(planSync([review(1)], paused(["doc-1"]))).toEqual([
      {
        action: "approve",
        itemId: "item-1",
        documentId: "doc-1",
        runId: "run-1",
        verdict: "correct",
        decision: { approved: true, reviewer: "langfuse:user-1" },
      },
    ]);
  });

  it("approves a corrected review with the corrected invoice", () => {
    const corrected = { ...invoice, totalCents: 10285 };
    const [planned] = planSync(
      [
        review(1, {
          verdict: "corrected",
          correction: JSON.stringify(corrected),
        }),
      ],
      paused(["doc-1"]),
    );
    expect(planned).toMatchObject({
      action: "approve",
      verdict: "corrected",
      decision: {
        approved: true,
        reviewer: "langfuse:user-1",
        invoice: corrected,
      },
    });
  });

  it("reports a corrected review whose correction is not a valid invoice, and leaves it paused", () => {
    const plans = planSync(
      [
        review(1, { verdict: "corrected", correction: "{ not json" }),
        review(2, {
          verdict: "corrected",
          correction: JSON.stringify({ ...invoice, totalCents: 102.85 }),
        }),
        review(3, { verdict: "corrected", correction: undefined }),
      ],
      paused(["doc-1", "doc-2", "doc-3"]),
    );
    expect(plans.map((p) => p.action)).toEqual(["report", "report", "report"]);
    expect(plans[0]).toMatchObject({ reason: expect.stringContaining("JSON") });
    expect(plans[1]).toMatchObject({
      reason: expect.stringContaining("totalCents"),
    });
    expect(plans[2]).toMatchObject({
      reason: expect.stringContaining("no corrected output"),
    });
  });

  it("rejects an unusable review", () => {
    expect(
      planSync([review(1, { verdict: "unusable" })], paused(["doc-1"])),
    ).toEqual([
      {
        action: "reject",
        itemId: "item-1",
        documentId: "doc-1",
        runId: "run-1",
        verdict: "unusable",
        decision: { approved: false, reviewer: "langfuse:user-1" },
      },
    ]);
  });

  it("skips a run that is no longer paused, so a second sync resumes nothing", () => {
    const plans = planSync(
      [review(1), review(2, { verdict: "unusable" })],
      new Map([
        ["doc-1", "valid" as const],
        ["doc-2", "rejected" as const],
      ]),
    );
    expect(plans).toEqual([
      expect.objectContaining({
        action: "skip",
        itemId: "item-1",
        reason: "already resolved (valid)",
      }),
      expect.objectContaining({
        action: "skip",
        itemId: "item-2",
        reason: "already resolved (rejected)",
      }),
    ]);
  });

  it("reports a completed review without a verdict", () => {
    expect(
      planSync([review(1, { verdict: undefined })], paused(["doc-1"])),
    ).toEqual([
      expect.objectContaining({
        action: "report",
        reason: "completed without a verdict",
      }),
    ]);
  });

  it("reports a review that cannot be mapped to its run", () => {
    const plans = planSync(
      [
        review(1, { generation: undefined }),
        review(2, {
          generation: { ...review(2).generation, runId: undefined } as never,
        }),
      ],
      paused(["doc-2"]),
    );
    expect(plans.map((p) => p.action)).toEqual(["report", "report"]);
  });

  it("names the reviewer 'langfuse' when the author is unknown", () => {
    const [planned] = planSync(
      [review(1, { reviewer: undefined })],
      paused(["doc-1"]),
    );
    expect(planned).toMatchObject({
      decision: { approved: true, reviewer: "langfuse" },
    });
  });

  it("resolves each paused document once, even if it was queued twice", () => {
    const plans = planSync(
      [review(1), { ...review(1), itemId: "item-1b" }],
      paused(["doc-1"]),
    );
    expect(plans.map((p) => p.action)).toEqual(["approve", "skip"]);
  });
});
