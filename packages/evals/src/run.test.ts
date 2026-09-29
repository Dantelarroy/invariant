import type { Invoice } from "@invariant/schema";
import { describe, expect, it } from "vitest";
import type { DatasetItem } from "./dataset.js";
import { evaluateDocuments } from "./run.js";

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
