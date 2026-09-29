import type { Invoice } from "@invariant/schema";
import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import {
  type Document,
  extractInvoiceFromDocument,
  UnsupportedDocumentError,
} from "./extract-from-document.js";

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

/** A fake model that always answers with the given JSON text. */
function mockModelAnswering(json: unknown) {
  return new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: "text", text: JSON.stringify(json) }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: {
          total: 1500,
          noCache: 1500,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: { total: 90, text: 90, reasoning: undefined },
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

/** A few bytes stand in for a real file: the mock model never reads them. */
const pdf: Document = {
  bytes: new TextEncoder().encode("%PDF-1.7 fake"),
  mediaType: "application/pdf",
};
const jpeg: Document = {
  bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
  mediaType: "image/jpeg",
};

/** The parts of the user message the model received. */
function userParts(model: MockLanguageModelV4) {
  const prompt = model.doGenerateCalls[0]?.prompt ?? [];
  const user = prompt.find((message) => message.role === "user");
  return user && Array.isArray(user.content) ? user.content : [];
}

describe("extractInvoiceFromDocument", () => {
  it("returns a schema-valid invoice from a PDF with the document prompt version and token usage", async () => {
    const model = mockModelAnswering(modelOutput);

    const result = await extractInvoiceFromDocument(pdf, model);

    expect(result.invoice).toEqual(invoice);
    expect(result.promptVersion).toBe("extract-document-v2");
    expect(result.usage).toEqual({ inputTokens: 1500, outputTokens: 90 });
  });

  it("sends a JPEG as a file part with media type image/jpeg, next to the instructions", async () => {
    const model = mockModelAnswering(modelOutput);

    const result = await extractInvoiceFromDocument(jpeg, model);

    const parts = userParts(model);
    const file = parts.find((part) => part.type === "file");
    expect(file?.mediaType).toBe("image/jpeg");
    expect(parts.some((part) => part.type === "text")).toBe(true);
    expect(JSON.stringify(model.doGenerateCalls[0]?.prompt)).toContain(
      "Money is integer cents",
    );
    expect(result.invoice).toEqual(invoice);
  });

  it("tells the model that withholding is a positive amount and tax ids are bare", async () => {
    const model = mockModelAnswering(modelOutput);

    await extractInvoiceFromDocument(pdf, model);

    // Baseline v1 (docs/evals.md): IRPF came back negative on every invoice
    // with withholding, and tax ids kept prefixes such as "NIF".
    const prompt = JSON.stringify(model.doGenerateCalls[0]?.prompt);
    expect(prompt).toContain("Withholding (IRPF) is a positive amount");
    expect(prompt).toContain("Tax IDs contain only the identifier");
  });

  it("rejects an unsupported media type before calling the model, naming the supported ones", async () => {
    const model = mockModelAnswering(modelOutput);
    const html: Document = {
      bytes: new TextEncoder().encode("<html></html>"),
      mediaType: "text/html",
    };

    const extraction = extractInvoiceFromDocument(html, model);

    await expect(extraction).rejects.toThrow(UnsupportedDocumentError);
    await expect(extraction).rejects.toThrow(/text\/html/);
    await expect(extraction).rejects.toThrow(/application\/pdf/);
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("rejects an empty document before calling the model", async () => {
    const model = mockModelAnswering(modelOutput);
    const empty: Document = { bytes: new Uint8Array(), mediaType: "image/png" };

    const extraction = extractInvoiceFromDocument(empty, model);

    await expect(extraction).rejects.toThrow(UnsupportedDocumentError);
    await expect(extraction).rejects.toThrow(/empty/);
    expect(model.doGenerateCalls).toHaveLength(0);
  });

  it("fails validation when the model returns amounts that are not integer cents", async () => {
    const model = mockModelAnswering({ ...modelOutput, totalCents: 66.5 });

    await expect(extractInvoiceFromDocument(pdf, model)).rejects.toThrow();
  });

  it("returns well-formed but inconsistent output unchanged, for the rule verifier to flag", async () => {
    // The line says 60,00 € but the tax base says 50,00 €: shape is fine, sense is not.
    const inconsistent = { ...invoice, taxBaseCents: 5000 };
    const model = mockModelAnswering({
      ...modelOutput,
      taxBaseCents: 5000,
    });

    const result = await extractInvoiceFromDocument(pdf, model);

    expect(result.invoice).toEqual(inconsistent);
  });
});
