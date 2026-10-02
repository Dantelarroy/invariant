import type { Invoice } from "@invariant/schema";
import { describe, expect, it } from "vitest";
import type { DatasetItem, DocumentItem } from "./dataset.js";
import { type DocumentTracer, evaluateDocuments } from "./run.js";
import type { RuleScore } from "./score.js";
import {
  type DocumentResult,
  summarize,
  summarizeRepair,
  summarizeRules,
  summarizeRulesRepair,
} from "./summarize.js";

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

describe("evaluateDocuments with a tracer", () => {
  const usage = { inputTokens: 100, outputTokens: 10 };
  const misreadTaxId: Invoice = {
    ...invoice,
    supplier: { name: "Proveedor SL", taxId: "B12345678" },
  };

  /** Records what the runner asks the tracer to do, in order. */
  function fakeTracer() {
    const calls: string[] = [];
    const ended: DocumentResult<RuleScore>[] = [];
    const tracer: DocumentTracer = {
      startDocument: (doc) => {
        calls.push(`start ${doc.id}`);
        return {
          generation: async (kind, call) => {
            calls.push(`${kind} ${doc.id}`);
            try {
              return await call();
            } catch (error) {
              calls.push(`${kind} failed ${doc.id}`);
              throw error;
            }
          },
          verified: (kind, verification) => {
            calls.push(`${kind} verified ${doc.id} ${verification.valid}`);
          },
          end: (result) => {
            calls.push(`end ${doc.id}`);
            ended.push(result);
          },
        };
      },
    };
    return { tracer, calls, ended };
  }

  it("opens one trace per document, with a verified generation per model call, and ends it with the result", async () => {
    const { tracer, calls, ended } = fakeTracer();

    const results = await evaluateDocuments(
      [item("ok"), item("fixed"), item("broken")],
      async (doc) => {
        if (doc.id === "broken") throw new Error("model timed out");
        return {
          invoice: doc.id === "ok" ? invoice : misreadTaxId,
          usage,
        };
      },
      {
        today: "2026-09-29",
        tracer,
        repair: async () => ({ invoice, usage }),
      },
    );

    expect(calls).toEqual([
      "start ok",
      "extract ok",
      "extract verified ok true",
      "end ok",
      "start fixed",
      "extract fixed",
      "extract verified fixed false",
      "repair fixed",
      "repair verified fixed true",
      "end fixed",
      "start broken",
      "extract broken",
      "extract failed broken",
      "end broken",
    ]);
    expect(ended).toEqual(results);
  });

  it("returns the same results with and without a tracer", async () => {
    const extract = async () => ({ invoice: misreadTaxId, usage });
    const repair = async () => ({ invoice, usage });
    const withoutLatency = (results: DocumentResult[]) =>
      results.map(({ latencyMs, repair, ...rest }) => ({
        ...rest,
        repair: repair && { ...repair, latencyMsBefore: 0 },
      }));

    const plain = await evaluateDocuments([item("a")], extract, {
      today: "2026-09-29",
      repair,
    });
    const traced = await evaluateDocuments([item("a")], extract, {
      today: "2026-09-29",
      repair,
      tracer: fakeTracer().tracer,
    });

    expect(withoutLatency(traced)).toEqual(withoutLatency(plain));
  });
});

describe("evaluateDocuments without labels", () => {
  const usage = { inputTokens: 100, outputTokens: 10 };
  const misreadTaxId: Invoice = {
    ...invoice,
    supplier: { name: "Proveedor SL", taxId: "B12345678" },
  };
  const unlabeled = (id: string): DocumentItem => ({
    id,
    path: `${id}.png`,
    mediaType: "image/png",
    source: "declarando",
  });

  it("extracts and verifies the rules, with no field scores", async () => {
    const results = await evaluateDocuments(
      [unlabeled("ok"), unlabeled("bad"), unlabeled("broken")],
      async (doc) => {
        if (doc.id === "broken") throw new Error("model timed out");
        return { invoice: doc.id === "ok" ? invoice : misreadTaxId, usage };
      },
      { today: "2026-09-29" },
    );

    expect(results.map((r) => r.score)).toEqual([
      { rules: { valid: true, failedRuleIds: [] } },
      { rules: { valid: false, failedRuleIds: ["tax-ids"] } },
      { rules: { valid: false, failedRuleIds: [] } },
    ]);
    expect(results[2]?.error).toBe("model timed out");
    expect(summarizeRules(results)).toEqual({
      documents: 3,
      rulePassRate: 1 / 3,
      failures: 1,
      inputTokens: 200,
      outputTokens: 20,
      medianLatencyMs: expect.any(Number),
    });
  });

  it("repairs documents with rule errors and reports the rules before and after", async () => {
    const repaired: string[] = [];
    const results = await evaluateDocuments(
      [unlabeled("ok"), unlabeled("bad")],
      async (doc) => ({
        invoice: doc.id === "ok" ? invoice : misreadTaxId,
        usage,
      }),
      {
        today: "2026-09-29",
        repair: async (doc) => {
          repaired.push(doc.id);
          return { invoice, usage };
        },
      },
    );

    expect(repaired).toEqual(["bad"]);
    expect(results[1]?.score).toEqual({
      rules: { valid: true, failedRuleIds: [] },
    });
    expect(results[1]?.repair).toMatchObject({
      attempted: true,
      used: true,
      scoreBefore: { rules: { valid: false, failedRuleIds: ["tax-ids"] } },
    });
    const summary = summarizeRulesRepair(results);
    expect(summary.before.rulePassRate).toBe(0.5);
    expect(summary.after.rulePassRate).toBe(1);
    expect(summary.repairsAttempted).toBe(1);
    expect(summary.repairsUsed).toBe(1);
    expect(summary.after).not.toHaveProperty("exactMatchRate");
  });
});
