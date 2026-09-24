import { createHash, randomUUID } from "node:crypto";
import { createDb, documents, findDocumentBySha256 } from "@invariant/db";
import type { Invoice } from "@invariant/schema";
import { MockLanguageModelV4 } from "ai/test";
import { inArray } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { processTextDocument } from "./process-text-document.js";

const databaseUrl = process.env.DATABASE_URL;

const invoice: Invoice = {
  number: "F-1",
  issueDate: "2026-09-24",
  currency: "EUR",
  supplier: { name: "Proveedor SL" },
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

function mockModelAnswering(json: unknown) {
  return new MockLanguageModelV4({
    doGenerate: {
      content: [{ type: "text", text: JSON.stringify(json) }],
      finishReason: { unified: "stop", raw: "stop" },
      usage: {
        inputTokens: {
          total: 10,
          noCache: 10,
          cacheRead: undefined,
          cacheWrite: undefined,
        },
        outputTokens: { total: 10, text: 10, reasoning: undefined },
      },
      warnings: [],
    },
  });
}

describe.skipIf(!databaseUrl)("processTextDocument (integration)", () => {
  const { db, close } = createDb(databaseUrl as string);
  const createdIds: string[] = [];

  afterAll(async () => {
    if (createdIds.length > 0)
      await db.delete(documents).where(inArray(documents.id, createdIds));
    await close();
  });

  it("extracts, stores and marks the document for review; a second run is a duplicate", async () => {
    const text = `invoice text ${randomUUID()}`;

    const first = await processTextDocument(
      db,
      mockModelAnswering(invoice),
      text,
    );
    createdIds.push(first.documentId);
    expect(first.kind).toBe("extracted");

    const second = await processTextDocument(
      db,
      mockModelAnswering(invoice),
      text,
    );
    expect(second).toEqual({ kind: "duplicate", documentId: first.documentId });
  });

  it("marks the document as rejected when the model output is not an invoice", async () => {
    const text = `broken ${randomUUID()}`;

    const outcome = await processTextDocument(
      db,
      mockModelAnswering({ nonsense: true }),
      text,
    );
    createdIds.push(outcome.documentId);

    expect(outcome.kind).toBe("failed");
    const doc = await findDocumentBySha256(
      db,
      (await import("node:crypto"))
        .createHash("sha256")
        .update(text)
        .digest("hex"),
    );
    expect(doc?.status).toBe("rejected");
  });
});
