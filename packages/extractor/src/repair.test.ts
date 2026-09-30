import type { Invoice } from "@invariant/schema";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import type { Document } from "./extract-from-document.js";
import { extractInvoiceFromText } from "./extract-from-text.js";
import { repairInvoice } from "./repair.js";

const invoice: Invoice = {
  number: "F-2026-0042",
  issueDate: "2026-09-24",
  currency: "EUR",
  supplier: { name: "Aceites García SL", taxId: "B12345674" },
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

/** What a strict structured-output model returns: optional fields as explicit nulls. */
function modelOutputFor(inv: Invoice) {
  return {
    ...inv,
    supplier: { name: inv.supplier.name, taxId: inv.supplier.taxId ?? null },
    customer: { name: inv.customer.name, taxId: inv.customer.taxId ?? null },
    withholdingCents: inv.withholdingCents ?? null,
  };
}

function answer(json: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(json) }],
    finishReason: { unified: "stop" as const, raw: "stop" },
    usage: {
      inputTokens: {
        total: 100,
        noCache: 100,
        cacheRead: undefined,
        cacheWrite: undefined,
      },
      outputTokens: { total: 20, text: 20, reasoning: undefined },
    },
    warnings: [],
  };
}

/** A model that answers each call with the next JSON in order. */
function mockModelAnswering(...jsons: unknown[]) {
  return new MockLanguageModelV4({ doGenerate: jsons.map(answer) });
}

const source = `FACTURA F-2026-0042
Aceites García SL · CIF B12345674
2 × Aceite de oliva virgen extra 5 L · 60,00 €
Base 60,00 € · IVA 10 % 6,00 € · Total 66,00 €`;

/** The first answer misread the supplier's tax id and a line total. */
const misread: Invoice = {
  ...invoice,
  supplier: { name: "Aceites García SL", taxId: "B12345678" },
  lines: [
    {
      ...(invoice.lines[0] as Invoice["lines"][0]),
      description: "ACEITE MAL LEIDO",
      lineTotalCents: 6000,
    },
  ],
};

const taxIdError = {
  ruleId: "tax-ids",
  severity: "error" as const,
  message:
    'The supplier\'s tax id "B12345678" is not valid: CIF control should be 4.',
  path: "supplier.taxId",
};
const lineWarning = {
  ruleId: "line-amount",
  severity: "warning" as const,
  message: "Line 1: 2 × 30,00 € is 60,00 €, but the line says 54,00 €.",
  path: "lines[0].lineTotalCents",
};

function promptOf(model: MockLanguageModelV4, call: number) {
  return model.doGenerateCalls[call]?.prompt ?? [];
}

describe("repairInvoice", () => {
  it("sends the repair instructions, the error messages and the original text, and nothing from the previous answer", async () => {
    const model = mockModelAnswering(
      modelOutputFor(misread),
      modelOutputFor(invoice),
    );
    const first = await extractInvoiceFromText(source, model);

    const repaired = await repairInvoice(
      { text: source },
      [lineWarning, taxIdError],
      model,
    );

    expect(model.doGenerateCalls).toHaveLength(2);
    const prompt = promptOf(model, 1);
    // One clean user message: no previous conversation, no assistant answer.
    expect(prompt.map((m) => m.role).filter((r) => r !== "system")).toEqual([
      "user",
    ]);
    const sent = JSON.stringify(prompt);
    expect(sent).toContain("failed these consistency checks");
    expect(sent).toContain(
      JSON.stringify(`- ${taxIdError.message}`).slice(1, -1),
    );
    expect(sent).toContain(JSON.stringify(source).slice(1, -1));
    // Warnings are not repaired, and the first answer is never shown.
    expect(sent).not.toContain("the line says 54,00");
    expect(sent).not.toContain("ACEITE MAL LEIDO");
    expect(sent).not.toContain(JSON.stringify(first.invoice).slice(1, -1));
    expect(repaired.invoice).toEqual(invoice);
  });

  it("sends a document as a file part with the same bytes and media type", async () => {
    const model = mockModelAnswering(modelOutputFor(invoice));
    const jpeg: Document = {
      bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x42]),
      mediaType: "image/jpeg",
    };

    await repairInvoice({ document: jpeg }, [taxIdError], model);

    const user = promptOf(model, 0).find((m) => m.role === "user");
    const parts = user && Array.isArray(user.content) ? user.content : [];
    const file = parts.find((part) => part.type === "file");
    expect(file?.mediaType).toBe("image/jpeg");
    expect(file?.data).toEqual({ type: "data", data: jpeg.bytes });
    const texts = JSON.stringify(parts.filter((part) => part.type === "text"));
    expect(texts).toContain(taxIdError.message.replaceAll('"', '\\"'));
    // The document rules (positive withholding, bare tax ids) still apply.
    expect(texts).toContain("Tax IDs contain only the identifier");
  });

  it("returns the repaired invoice with prompt version repair-v1", async () => {
    const model = mockModelAnswering(modelOutputFor(invoice));

    const result = await repairInvoice({ text: source }, [taxIdError], model);

    expect(result.promptVersion).toBe("repair-v1");
    expect(result.invoice).toEqual(invoice);
  });

  it("throws without calling the model when there is no error to repair", async () => {
    const model = mockModelAnswering(modelOutputFor(invoice));

    await expect(repairInvoice({ text: source }, [], model)).rejects.toThrow(
      /no error/i,
    );
    await expect(
      repairInvoice({ text: source }, [lineWarning], model),
    ).rejects.toThrow(/no error/i);
    expect(model.doGenerateCalls).toHaveLength(0);
  });
});
