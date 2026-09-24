import { randomUUID } from "node:crypto";
import {
  createDb,
  deleteDocuments,
  findDocumentById,
  findInvoiceByDocumentId,
} from "@invariant/db";
import type { Invoice } from "@invariant/schema";
import { MockLanguageModelV4 } from "ai/test";
import { afterAll, describe, expect, it } from "vitest";
import {
  createInvariantMastra,
  processDocument,
  type RunResult,
  reviewDocument,
} from "../mastra.js";

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

/** What a strict structured-output model returns: optional fields as explicit nulls. */
function modelOutputFor(inv: Invoice) {
  return {
    ...inv,
    supplier: { name: inv.supplier.name, taxId: null },
    customer: { name: inv.customer.name, taxId: null },
    withholdingCents: null,
  };
}

/** The printed total is wrong: base + VAT is 12,10 € but the document says 13,10 €. */
const inconsistentInvoice: Invoice = { ...invoice, totalCents: 1310 };

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

describe.skipIf(!databaseUrl)("process-document workflow (integration)", () => {
  const url = databaseUrl as string;
  const { db, close } = createDb(url);
  const createdIds: string[] = [];
  const openStores: (() => Promise<void>)[] = [];

  /** A fresh Mastra instance, as if the process had just started. */
  function mastraAnswering(json: unknown) {
    const instance = createInvariantMastra({
      db,
      model: mockModelAnswering(json),
      databaseUrl: url,
    });
    openStores.push(instance.close);
    return instance.mastra;
  }

  async function statusOf(documentId: string) {
    return (await findDocumentById(db, documentId))?.status;
  }

  function track(result: RunResult) {
    createdIds.push(result.documentId);
    return result;
  }

  afterAll(async () => {
    await deleteDocuments(db, createdIds);
    await Promise.all(openStores.map((closeStore) => closeStore()));
    await close();
  });

  it("accepts a consistent invoice without asking; a second run is a duplicate", async () => {
    const mastra = mastraAnswering(modelOutputFor(invoice));
    const text = `invoice ${randomUUID()}`;

    const first = track(await processDocument(mastra, { text }));
    expect(first).toMatchObject({ kind: "accepted", reviewedBy: "rules" });
    expect(await statusOf(first.documentId)).toBe("valid");

    const second = await processDocument(mastra, { text });
    expect(second).toEqual({
      kind: "duplicate",
      documentId: first.documentId,
    });
  });

  it("rejects the document when the model output is not an invoice", async () => {
    const mastra = mastraAnswering({ nonsense: true });

    const result = track(
      await processDocument(mastra, { text: `broken ${randomUUID()}` }),
    );

    expect(result.kind).toBe("failed");
    expect(await statusOf(result.documentId)).toBe("rejected");
  });

  it("pauses an inconsistent invoice for review and resumes it after a restart", async () => {
    const paused = track(
      await processDocument(
        mastraAnswering(modelOutputFor(inconsistentInvoice)),
        {
          text: `inconsistent ${randomUUID()}`,
        },
      ),
    );
    if (paused.kind !== "needs_review") throw new Error(`got ${paused.kind}`);
    expect(paused.issues.map((i) => i.code)).toEqual(["TOTAL_MISMATCH"]);
    expect(await statusOf(paused.documentId)).toBe("needs_review");

    // A brand-new instance: the paused state must come from Postgres, not memory.
    const afterRestart = mastraAnswering({ unused: true });
    const resumed = await reviewDocument(afterRestart, paused.runId, {
      approved: true,
      reviewer: "dante",
    });

    expect(resumed).toMatchObject({
      kind: "accepted",
      reviewedBy: "dante",
      totalCents: 1310,
    });
    expect(await statusOf(paused.documentId)).toBe("valid");
  });

  it("stores nothing when the reviewer rejects the extraction", async () => {
    const mastra = mastraAnswering(modelOutputFor(inconsistentInvoice));
    const paused = track(
      await processDocument(mastra, { text: `reject ${randomUUID()}` }),
    );
    if (paused.kind !== "needs_review") throw new Error(`got ${paused.kind}`);

    const result = await reviewDocument(mastra, paused.runId, {
      approved: false,
      reviewer: "dante",
    });

    expect(result).toEqual({
      kind: "rejected",
      documentId: paused.documentId,
      reviewedBy: "dante",
    });
    expect(await statusOf(paused.documentId)).toBe("rejected");
    expect(
      await findInvoiceByDocumentId(db, paused.documentId),
    ).toBeUndefined();
  });

  it("retries a previously rejected document instead of treating it as a duplicate", async () => {
    const text = `retry ${randomUUID()}`;
    const failed = track(
      await processDocument(mastraAnswering({ nonsense: true }), { text }),
    );

    const retried = await processDocument(
      mastraAnswering(modelOutputFor(invoice)),
      { text },
    );

    expect(retried.kind).toBe("accepted");
    expect(retried.documentId).toBe(failed.documentId);
  });
});
