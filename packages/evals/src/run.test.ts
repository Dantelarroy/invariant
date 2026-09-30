import type { Invoice } from "@invariant/schema";
import { describe, expect, it } from "vitest";
import type { DatasetItem } from "./dataset.js";
import { evaluateDocuments } from "./run.js";
import { summarize, summarizeRepair } from "./summarize.js";

const invoice: Invoice = {
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

const item = (id: string): DatasetItem => ({
  id,
  invoice,
  path: `${id}.pdf`,
  mediaType: "application/pdf",
});

describe("evaluateDocuments", () => {
  it("extracts one document at a time, in order, and keeps going after a failure", async () => {
    const seen: string[] = [];

    const results = await evaluateDocuments(
      [item("a"), item("b"), item("c")],
      async (doc) => {
        seen.push(doc.id);
        if (doc.id === "b") throw new Error("model timed out");
        return { invoice, usage: { inputTokens: 100, outputTokens: 10 } };
      },
      { today: "2026-09-29" },
    );

    expect(seen).toEqual(["a", "b", "c"]);
    expect(results.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(results[0]?.score.exactMatch).toBe(true);
    expect(results[1]?.error).toBe("model timed out");
    expect(results[1]?.score.fields.totalCents.match).toBe(false);
    expect(results[1]?.usage).toEqual({
      inputTokens: undefined,
      outputTokens: undefined,
    });
    expect(results[2]?.usage).toEqual({ inputTokens: 100, outputTokens: 10 });
    expect(results.every((r) => r.latencyMs >= 0)).toBe(true);
  });
});

describe("evaluateDocuments with repair", () => {
  /** The supplier's tax id is misread (its CIF control digit should be 4). */
  const misreadTaxId: Invoice = {
    ...invoice,
    supplier: { name: "Proveedor SL", taxId: "B12345678" },
  };
  /** Misread tax id and a wrong total: two errors. */
  const worse: Invoice = { ...misreadTaxId, totalCents: 1310 };
  const usage = { inputTokens: 100, outputTokens: 10 };

  it("repairs only documents with errors, keeps the better extraction and reports before and after", async () => {
    const repaired: string[] = [];
    const extractions: Record<string, Invoice> = {
      ok: invoice,
      fixed: misreadTaxId,
      worse: misreadTaxId,
      same: misreadTaxId,
    };
    const repairs: Record<string, Invoice> = {
      fixed: invoice,
      worse,
      same: misreadTaxId,
    };

    const results = await evaluateDocuments(
      [item("ok"), item("fixed"), item("worse"), item("same")],
      async (doc) => ({
        invoice: extractions[doc.id] as Invoice,
        usage,
      }),
      {
        today: "2026-09-29",
        repair: async (doc, issues) => {
          repaired.push(doc.id);
          // Only errors reach the repairer's decision, but it gets the issues as verified.
          expect(issues.some((i) => i.severity === "error")).toBe(true);
          return { invoice: repairs[doc.id] as Invoice, usage };
        },
      },
    );

    expect(repaired).toEqual(["fixed", "worse", "same"]);
    expect(
      results.map((r) => [r.id, r.repair?.attempted, r.repair?.used]),
    ).toEqual([
      ["ok", false, false],
      ["fixed", true, true],
      ["worse", true, false],
      ["same", true, false],
    ]);
    // After: the chosen extraction; before: the first one.
    expect(results[1]?.score.rules.valid).toBe(true);
    expect(results[1]?.repair?.scoreBefore.rules.valid).toBe(false);
    expect(results[2]?.score.fields.totalCents.match).toBe(true);
    // A repair adds its tokens to the document's usage.
    expect(results[1]?.usage).toEqual({ inputTokens: 200, outputTokens: 20 });
    expect(results[1]?.repair?.usageBefore).toEqual(usage);

    const summary = summarizeRepair(results);
    expect(summary.repairsAttempted).toBe(3);
    expect(summary.repairsUsed).toBe(1);
    expect(summary.before.rulePassRate).toBe(0.25);
    expect(summary.after.rulePassRate).toBe(0.5);
    expect(summary.before.exactMatchRate).toBe(0.25);
    expect(summary.after.exactMatchRate).toBe(0.5);
    expect(summary.after).toEqual(summarize(results));
    expect(summary.before.inputTokens).toBe(400);
    expect(summary.after.inputTokens).toBe(700);
  });

  it("keeps the first extraction when the repair throws, and records the error", async () => {
    const [result] = await evaluateDocuments(
      [item("a")],
      async () => ({ invoice: misreadTaxId, usage }),
      {
        today: "2026-09-29",
        repair: async () => {
          throw new Error("rate limited");
        },
      },
    );

    expect(result?.error).toBeUndefined();
    expect(result?.repair).toMatchObject({
      attempted: true,
      used: false,
      error: "rate limited",
    });
    expect(result?.score.fields.supplierTaxId.match).toBe(false);
  });

  it("does not add repair fields without the repair option", async () => {
    const [result] = await evaluateDocuments(
      [item("a")],
      async () => ({ invoice: misreadTaxId, usage }),
      { today: "2026-09-29" },
    );

    expect(result).not.toHaveProperty("repair");
  });
});
