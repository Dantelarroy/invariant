import type { Invoice } from "@invariant/schema";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import { extractInvoiceFromText } from "./extract-from-text.js";

const invoice: Invoice = {
  number: "F-2026-0042",
  issueDate: "2026-09-24",
  currency: "EUR",
  supplier: { name: "Aceites García SL", taxId: "B12345678" },
  customer: { name: "Restaurante Sol" },
  lines: [
    {
      description: "Aceite de oliva virgen extra 5 L",
      quantity: 2,
      unitPriceCents: 3000,
      lineTotalCents: 6000,
      vatRateBps: 1000,
    },
  ],
  taxBaseCents: 6000,
  vatAmountCents: 600,
  totalCents: 6600,
};

/** A fake model that always answers with the given JSON text. */
function mockModelAnswering(json: unknown) {
  return new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: "text", text: JSON.stringify(json) }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: {
          total: 120,
          noCache: 120,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: { total: 80, text: 80, reasoning: undefined },
      },
      warnings: [],
    },
  });
}

/** What a strict structured-output model returns: optional fields as explicit nulls. */
const modelOutput = {
  ...invoice,
  customer: { name: "Restaurante Sol", taxId: null },
  withholdingCents: null,
};

describe("extractInvoiceFromText", () => {
  it("returns the validated invoice, prompt version and token usage", async () => {
    const model = mockModelAnswering(modelOutput);

    const result = await extractInvoiceFromText(
      "FACTURA F-2026-0042 ...",
      model,
    );

    expect(result.invoice).toEqual(invoice);
    expect(result.promptVersion).toBe("extract-text-v1");
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 80 });
  });

  it("sends the instructions as system prompt and the document as user prompt", async () => {
    const model = mockModelAnswering(modelOutput);

    await extractInvoiceFromText("FACTURA F-2026-0042 ...", model);

    const prompt = JSON.stringify(model.doGenerateCalls[0]?.prompt);
    expect(prompt).toContain("Money is integer cents");
    expect(prompt).toContain("FACTURA F-2026-0042");
  });

  it("fails loudly when the model returns something that is not an invoice", async () => {
    const model = mockModelAnswering({ totalCents: "sesenta euros" });

    await expect(extractInvoiceFromText("...", model)).rejects.toThrow();
  });
});
