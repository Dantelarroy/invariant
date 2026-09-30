import { randomUUID } from "node:crypto";
import {
  createDb,
  createDocument,
  deleteDocuments,
  findDocumentById,
  findInvoiceByDocumentId,
  setDocumentStatus,
} from "@invariant/db";
import {
  createObservability,
  observabilityWith,
  type PromptResolver,
} from "@invariant/observability";
import { verifyInvoice } from "@invariant/rules";
import { type Invoice, InvoiceSchema } from "@invariant/schema";
import { Mastra } from "@mastra/core";
import { SpanType } from "@mastra/core/observability";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import { TestExporter } from "@mastra/observability";
import { PostgresStore } from "@mastra/pg";
import { MockLanguageModelV4 } from "ai/test";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  createInvariantMastra,
  processDocument,
  type RunResult,
  reviewDocument,
} from "../mastra.js";
import { HUMAN_REVIEW_STEP_ID } from "./process-document.js";

const databaseUrl = process.env.DATABASE_URL;

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

/** What a strict structured-output model returns: optional fields as explicit nulls. */
function modelOutputFor(inv: Invoice) {
  return {
    ...inv,
    supplier: { name: inv.supplier.name, taxId: inv.supplier.taxId ?? null },
    customer: { name: inv.customer.name, taxId: inv.customer.taxId ?? null },
    withholdingCents: null,
  };
}

/** The printed total is wrong: base + VAT is 12,10 € but the document says 13,10 €. */
const inconsistentInvoice: Invoice = { ...invoice, totalCents: 1310 };

function answer(json: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(json) }],
    finishReason: { unified: "stop" as const, raw: "stop" },
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
  };
}

/**
 * A fake model. With one answer it repeats it on every call; with several it
 * answers each call with the next one in order (e.g. wrong, then repaired).
 */
function mockModelAnswering(...jsons: unknown[]) {
  return new MockLanguageModelV4({
    doGenerate: jsons.length === 1 ? answer(jsons[0]) : jsons.map(answer),
  });
}

/** The supplier's tax id is misread: its CIF control digit should be 4. */
const misreadTaxIdInvoice: Invoice = {
  ...invoice,
  supplier: { name: "Proveedor SL", taxId: "B12345678" },
};

describe.skipIf(!databaseUrl)("process-document workflow (integration)", () => {
  const url = databaseUrl as string;
  const { db, close } = createDb(url);
  const createdIds: string[] = [];
  const openStores: (() => Promise<void>)[] = [];

  /** A fresh Mastra instance, as if the process had just started, and its model. */
  function setup(...jsons: unknown[]) {
    const model = mockModelAnswering(...jsons);
    const instance = createInvariantMastra({ db, model, databaseUrl: url });
    openStores.push(instance.close);
    return { mastra: instance.mastra, model };
  }

  function mastraAnswering(json: unknown) {
    return setup(json).mastra;
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
    const { mastra, model } = setup(modelOutputFor(invoice));
    const text = `invoice ${randomUUID()}`;

    const first = track(await processDocument(mastra, { text }));
    expect(first).toMatchObject({
      kind: "accepted",
      reviewedBy: "rules",
      repaired: false,
    });
    // No errors, no repair: the model is called once.
    expect(model.doGenerateCalls).toHaveLength(1);
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
    expect(paused.issues.map((i) => i.ruleId)).toEqual(["total"]);
    expect(paused.issues[0]?.details).toEqual({
      taxBaseCents: 1000,
      vatAmountCents: 210,
      withholdingCents: 0,
      expectedCents: 1210,
      printedCents: 1310,
    });
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

  describe("tracing", () => {
    /** A registry that serves every prompt version the code asks for. */
    const registry: PromptResolver = async (prompt) => ({
      text: prompt.text,
      link: { name: prompt.name, version: prompt.version },
    });

    /** A traced Mastra instance whose spans are exported to memory. */
    function tracedSetup(...jsons: unknown[]) {
      const exporter = new TestExporter();
      const instance = createInvariantMastra({
        db,
        model: mockModelAnswering(...jsons),
        databaseUrl: url,
        observability: observabilityWith([exporter]),
        resolvePrompt: registry,
      });
      openStores.push(instance.close);
      return { mastra: instance.mastra, exporter };
    }

    /** The last workflow run in the exporter: its steps, generations and root. */
    async function lastTrace(exporter: TestExporter) {
      await exporter.flush();
      const root = exporter.getSpansByType(SpanType.WORKFLOW_RUN).at(-1);
      if (!root) throw new Error("no workflow run was traced");
      const spans = exporter
        .getAllSpans()
        .filter((span) => span.traceId === root.traceId);
      const inRun = (type: SpanType) =>
        spans.filter(
          (span) => span.type === type && span.startTime >= root.startTime,
        );
      return {
        root,
        steps: inRun(SpanType.WORKFLOW_STEP),
        generations: inRun(SpanType.MODEL_INFERENCE),
      };
    }

    it("traces an accepted run: six steps, one extraction generation, branch accepted", async () => {
      const { mastra, exporter } = tracedSetup(modelOutputFor(invoice));

      const text = `traced ${randomUUID()}`;
      const result = track(
        await processDocument(mastra, { text, filename: "invoice.txt" }),
      );

      expect(result.kind).toBe("accepted");
      const { root, steps, generations } = await lastTrace(exporter);
      expect(steps.map((step) => step.entityId)).toEqual([
        "ingest",
        "extract",
        "verify",
        "repair",
        "human-review",
        "persist",
      ]);
      expect(generations.map((g) => g.name)).toEqual(["extract-text-v1"]);
      expect(generations[0]?.attributes).toMatchObject({
        responseModel: "mock-model-id",
        usage: { inputTokens: 10, outputTokens: 10 },
      });
      // Linked to its registry prompt, with the source text in and the invoice out.
      expect(generations[0]?.metadata?.langfuse).toEqual({
        prompt: { name: "extract-text", version: 1 },
      });
      expect(generations[0]?.input).toEqual({
        promptVersion: "extract-text-v1",
        text,
      });
      expect(generations[0]?.output).toEqual(invoice);
      expect(root.metadata).toMatchObject({
        branch: "accepted",
        documentId: result.documentId,
        filename: "invoice.txt",
        model: "mock-model-id",
        promptVersion: "extract-text-v1",
      });
      expect(root.tags).toEqual(["pipeline", "accepted"]);
    });

    it("traces a repaired run with two generations and branch repaired", async () => {
      const { mastra, exporter } = tracedSetup(
        modelOutputFor(misreadTaxIdInvoice),
        modelOutputFor(invoice),
      );

      const text = `traced repair ${randomUUID()}`;
      track(await processDocument(mastra, { text }));

      const { root, generations } = await lastTrace(exporter);
      expect(generations.map((g) => g.name)).toEqual([
        "extract-text-v1",
        "repair-v1",
      ]);
      expect(generations[1]?.metadata?.langfuse).toEqual({
        prompt: { name: "repair", version: 1 },
      });
      expect(generations[1]?.input).toEqual({
        promptVersion: "repair-v1",
        text,
      });
      expect(generations[1]?.output).toEqual(invoice);
      expect(root.metadata).toMatchObject({
        branch: "repaired",
        promptVersion: "repair-v1",
      });
      expect(root.tags).toEqual(["pipeline", "repaired"]);
    });

    it("traces a paused run as needs_review with the question, and its resumption with its own branch", async () => {
      const { mastra, exporter } = tracedSetup(
        modelOutputFor(inconsistentInvoice),
      );

      const paused = track(
        await processDocument(mastra, { text: `traced pause ${randomUUID()}` }),
      );
      if (paused.kind !== "needs_review") throw new Error(`got ${paused.kind}`);

      const pausedTrace = await lastTrace(exporter);
      expect(pausedTrace.root.metadata?.branch).toBe("needs_review");
      expect(pausedTrace.root.tags).toEqual(["pipeline", "needs_review"]);
      const review = pausedTrace.steps.find(
        (step) => step.entityId === "human-review",
      );
      expect(JSON.stringify(review?.output)).toContain(paused.question);

      await reviewDocument(mastra, paused.runId, {
        approved: false,
        reviewer: "dante",
      });

      const resumed = await lastTrace(exporter);
      expect(resumed.root.metadata).toMatchObject({
        branch: "rejected",
        documentId: paused.documentId,
      });
      expect(resumed.root.tags).toContain("rejected");
      expect(resumed.root.tags).not.toContain("needs_review");
    });

    it("never fails a run when Langfuse does not answer", async () => {
      const instance = createInvariantMastra({
        db,
        model: mockModelAnswering(modelOutputFor(invoice)),
        databaseUrl: url,
        // Nothing listens on port 9: every export fails.
        observability: createObservability(
          { LANGFUSE_BASE_URL: "http://127.0.0.1:9" },
          { environment: "test" },
        ),
      });

      const result = track(
        await processDocument(instance.mastra, {
          text: `langfuse down ${randomUUID()}`,
        }),
      );

      expect(result.kind).toBe("accepted");
      await expect(instance.close()).resolves.not.toThrow();
      // Closing waits for the failed export (a few seconds), then gives up quietly.
    }, 30_000);

    it("traces a failed extraction as failed and a second run as duplicate", async () => {
      const failing = tracedSetup({ nonsense: true });
      track(
        await processDocument(failing.mastra, {
          text: `traced failure ${randomUUID()}`,
        }),
      );
      expect((await lastTrace(failing.exporter)).root.metadata?.branch).toBe(
        "failed",
      );

      const { mastra, exporter } = tracedSetup(modelOutputFor(invoice));
      const text = `traced duplicate ${randomUUID()}`;
      track(await processDocument(mastra, { text }));
      await processDocument(mastra, { text });
      expect((await lastTrace(exporter)).root.metadata?.branch).toBe(
        "duplicate",
      );
    });
  });

  describe("rule-guided repair", () => {
    async function storedPromptVersion(documentId: string) {
      return (await findInvoiceByDocumentId(db, documentId))?.promptVersion;
    }

    it("accepts a repaired invoice without a person and keeps the repair prompt version", async () => {
      const { mastra, model } = setup(
        modelOutputFor(misreadTaxIdInvoice),
        modelOutputFor(invoice),
      );
      const text = `misread tax id ${randomUUID()}`;

      const result = track(await processDocument(mastra, { text }));

      expect(result).toMatchObject({
        kind: "accepted",
        reviewedBy: "rules",
        repaired: true,
      });
      expect(model.doGenerateCalls).toHaveLength(2);
      // The repair sees the original text and the violated rule, not the first answer.
      const repairRequest = JSON.stringify(model.doGenerateCalls[1]?.prompt);
      expect(repairRequest).toContain(text);
      expect(repairRequest).toContain("tax id");
      expect(repairRequest).not.toContain('"role":"assistant"');
      expect(await storedPromptVersion(result.documentId)).toBe("repair-v1");
    });

    it("asks a concrete question when the repair still fails, without a third call", async () => {
      const { mastra, model } = setup(
        modelOutputFor(inconsistentInvoice),
        modelOutputFor(inconsistentInvoice),
        modelOutputFor(invoice),
      );

      const paused = track(
        await processDocument(mastra, { text: `still wrong ${randomUUID()}` }),
      );

      if (paused.kind !== "needs_review") throw new Error(`got ${paused.kind}`);
      expect(model.doGenerateCalls).toHaveLength(2);
      expect(paused.issues.map((i) => i.ruleId)).toEqual(["total"]);
      expect(paused.question).toBe(
        "El total impreso es 13,10 € pero base + IVA − retención da 12,10 €. ¿El total del documento es 13,10 €?",
      );
    });

    it("keeps the original extraction when the repair is worse", async () => {
      const worse: Invoice = { ...misreadTaxIdInvoice, totalCents: 1310 };
      const { mastra, model } = setup(
        modelOutputFor(misreadTaxIdInvoice),
        modelOutputFor(worse),
      );

      const paused = track(
        await processDocument(mastra, { text: `worse ${randomUUID()}` }),
      );

      if (paused.kind !== "needs_review") throw new Error(`got ${paused.kind}`);
      expect(model.doGenerateCalls).toHaveLength(2);
      expect(paused.issues.map((i) => i.ruleId)).toEqual(["tax-ids"]);

      const approved = await reviewDocument(mastra, paused.runId, {
        approved: true,
        reviewer: "dante",
      });
      expect(approved).toMatchObject({
        kind: "accepted",
        reviewedBy: "dante",
        repaired: false,
        totalCents: 1210,
      });
      expect(await storedPromptVersion(paused.documentId)).toBe(
        "extract-text-v1",
      );
    });

    it("resumes a run suspended before the repair step existed, without repairing it", async () => {
      // The pre-repair shape: ingest → extract → verify → human-review (suspends).
      const legacyStep = (id: string, run: () => Promise<object>) =>
        createStep({
          id,
          inputSchema: z.any(),
          outputSchema: z.any(),
          execute: async ({ inputData }) => ({
            ...inputData,
            ...(await run()),
          }),
        });
      const text = `legacy ${randomUUID()}`;
      let documentId = "";
      const legacy = createWorkflow({
        id: "process-document",
        inputSchema: z.object({ text: z.string() }),
        outputSchema: z.any(),
      })
        .then(
          legacyStep("ingest", async () => {
            const doc = await createDocument(db, {
              sha256: randomUUID(),
              source: "upload",
              filename: null,
            });
            documentId = doc.id;
            await setDocumentStatus(db, doc.id, "processing");
            return { documentId: doc.id };
          }),
        )
        .then(
          legacyStep("extract", async () => ({
            invoice: InvoiceSchema.parse(inconsistentInvoice),
            promptVersion: "extract-text-v1",
          })),
        )
        .then(
          legacyStep("verify", async () => ({
            issues: verifyInvoice(inconsistentInvoice).violations,
          })),
        )
        .then(
          createStep({
            id: HUMAN_REVIEW_STEP_ID,
            inputSchema: z.any(),
            outputSchema: z.any(),
            execute: async ({ suspend }) => {
              await setDocumentStatus(db, documentId, "needs_review");
              return await suspend({});
            },
          }),
        )
        .commit();
      const storage = new PostgresStore({
        id: "legacy-workflows",
        connectionString: url,
        schemaName: "mastra",
      });
      openStores.push(() => storage.close());
      const legacyMastra = new Mastra({
        storage,
        logger: false,
        workflows: { processDocument: legacy },
      });
      const legacyRun = await legacyMastra
        .getWorkflow("processDocument")
        .createRun();
      const suspended = await legacyRun.start({ inputData: { text } });
      expect(suspended.status).toBe("suspended");
      createdIds.push(documentId);

      const { mastra, model } = setup(modelOutputFor(invoice));
      const resumed = await reviewDocument(mastra, legacyRun.runId, {
        approved: true,
        reviewer: "dante",
      });

      expect(model.doGenerateCalls).toHaveLength(0);
      expect(resumed).toMatchObject({
        kind: "accepted",
        reviewedBy: "dante",
        repaired: false,
        totalCents: 1310,
      });
      expect(await storedPromptVersion(documentId)).toBe("extract-text-v1");
    });
  });
});
