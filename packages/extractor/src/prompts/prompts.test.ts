import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import {
  EXTRACT_DOCUMENT_PROMPT,
  EXTRACT_DOCUMENT_PROMPT_VERSION,
  EXTRACT_TEXT_PROMPT,
  EXTRACT_TEXT_PROMPT_VERSION,
  extractInvoiceFromDocument,
  extractInvoiceFromText,
  PROMPTS,
  promptId,
  REPAIR_PROMPT,
  REPAIR_PROMPT_VERSION,
  repairInvoice,
} from "../index.js";
import { EXTRACT_DOCUMENT_INSTRUCTIONS as DOCUMENT_V1_INSTRUCTIONS } from "./extract-document-v1.js";

/** A valid model answer, so the call completes; only the request matters here. */
const modelOutput = {
  number: "F-1",
  issueDate: "2026-09-24",
  currency: "EUR",
  supplier: { name: "Proveedor SL", taxId: "B12345674" },
  customer: { name: "Cliente SL", taxId: null },
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
  withholdingCents: null,
  totalCents: 1210,
};

function mockModel() {
  return new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: "text", text: JSON.stringify(modelOutput) }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: {
          total: 1,
          noCache: 1,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: { total: 1, text: 1, reasoning: undefined },
      },
      warnings: [],
    },
  });
}

const sentTo = (model: MockLanguageModelV4) =>
  JSON.stringify(model.doGenerateCalls[0]?.prompt);

const OVERRIDE = "Instructions served by the prompt registry.";

describe("prompt definitions", () => {
  it("are families with numbered versions, and the old ids derive from them", () => {
    expect(EXTRACT_TEXT_PROMPT).toMatchObject({
      name: "extract-text",
      version: 2,
    });
    expect(EXTRACT_DOCUMENT_PROMPT).toMatchObject({
      name: "extract-document",
      version: 2,
    });
    expect(REPAIR_PROMPT).toMatchObject({ name: "repair", version: 1 });
    expect(EXTRACT_TEXT_PROMPT_VERSION).toBe("extract-text-v2");
    expect(EXTRACT_DOCUMENT_PROMPT_VERSION).toBe("extract-document-v2");
    expect(REPAIR_PROMPT_VERSION).toBe("repair-v1");
    expect(promptId(EXTRACT_DOCUMENT_PROMPT)).toBe("extract-document-v2");
  });

  it("lists every version defined in code, in seeding order, v1 included", () => {
    expect(PROMPTS.map(promptId)).toEqual([
      "extract-text-v1",
      "extract-text-v2",
      "extract-document-v1",
      "extract-document-v2",
      "repair-v1",
    ]);
    expect(PROMPTS[2]?.text).toBe(DOCUMENT_V1_INSTRUCTIONS);
    for (const prompt of PROMPTS) expect(prompt.text.length).toBeGreaterThan(0);
  });
});

describe("instructions override", () => {
  it("replaces the text instructions and keeps the prompt version", async () => {
    const model = mockModel();

    const result = await extractInvoiceFromText("FACTURA F-1", model, {
      instructions: OVERRIDE,
    });

    expect(sentTo(model)).toContain(OVERRIDE);
    expect(sentTo(model)).not.toContain("Money is integer cents");
    expect(result.promptVersion).toBe("extract-text-v2");
  });

  it("replaces the document instructions", async () => {
    const model = mockModel();

    await extractInvoiceFromDocument(
      { bytes: new Uint8Array([1, 2, 3]), mediaType: "application/pdf" },
      model,
      { instructions: OVERRIDE },
    );

    expect(sentTo(model)).toContain(OVERRIDE);
    expect(sentTo(model)).not.toContain("Ignore stamps");
  });

  it("replaces the repair instructions and keeps the failed checks", async () => {
    const model = mockModel();

    await repairInvoice(
      { text: "FACTURA F-1" },
      [{ severity: "error", message: "The total is wrong." }],
      model,
      { instructions: OVERRIDE },
    );

    expect(sentTo(model)).toContain(OVERRIDE);
    expect(sentTo(model)).toContain("- The total is wrong.");
    expect(sentTo(model)).not.toContain("failed these consistency checks");
  });
});
