import { createHash } from "node:crypto";
import {
  createDocument,
  type Db,
  findDocumentBySha256,
  saveInvoice,
  setDocumentStatus,
} from "@invariant/db";
import { extractInvoiceFromText } from "@invariant/extractor";
import { InvoiceSchema } from "@invariant/schema";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import type { LanguageModel } from "ai";
import { z } from "zod";
import { checkTotals } from "./check-totals.js";

export const HUMAN_REVIEW_STEP_ID = "human-review";

const IssueSchema = z.object({ code: z.string(), message: z.string() });

/** Final result of a run. Every run ends in exactly one of these. */
export const OutcomeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("duplicate"), documentId: z.string() }),
  z.object({
    kind: z.literal("failed"),
    documentId: z.string(),
    error: z.string(),
  }),
  z.object({
    kind: z.literal("accepted"),
    documentId: z.string(),
    invoiceId: z.string(),
    totalCents: z.number().int(),
    reviewedBy: z.string(),
  }),
  z.object({
    kind: z.literal("rejected"),
    documentId: z.string(),
    reviewedBy: z.string(),
  }),
]);
export type Outcome = z.infer<typeof OutcomeSchema>;

/** What the paused run shows the reviewer. */
export const ReviewRequestSchema = z.object({
  documentId: z.string(),
  issues: z.array(IssueSchema),
  question: z.string(),
});

/** What the reviewer answers to resume the run. */
export const ReviewDecisionSchema = z.object({
  approved: z.boolean(),
  reviewer: z.string().min(1),
});
export type ReviewDecision = z.infer<typeof ReviewDecisionSchema>;

const ExtractedSchema = z.object({
  documentId: z.string(),
  invoice: InvoiceSchema,
  promptVersion: z.string(),
});
const VerifiedSchema = ExtractedSchema.extend({ issues: z.array(IssueSchema) });
const ReviewedSchema = ExtractedSchema.extend({
  approved: z.boolean(),
  reviewedBy: z.string(),
});

/**
 * ingest → extract → verify → human-review → persist.
 * Dependencies are injected so tests can pass a mock model and a test database.
 */
export function createProcessDocumentWorkflow(deps: {
  db: Db;
  model: LanguageModel;
}) {
  const { db, model } = deps;

  // Idempotency: the same content (SHA-256) is processed only once,
  // unless it was rejected before, in which case it is retried.
  const ingest = createStep({
    id: "ingest",
    inputSchema: z.object({
      text: z.string(),
      filename: z.string().optional(),
    }),
    outputSchema: z.object({ documentId: z.string(), text: z.string() }),
    execute: async ({ inputData, bail }) => {
      const sha256 = createHash("sha256").update(inputData.text).digest("hex");
      const existing = await findDocumentBySha256(db, sha256);
      if (existing && existing.status !== "rejected") {
        return bail({ kind: "duplicate", documentId: existing.id });
      }
      const doc =
        existing ??
        (await createDocument(db, {
          sha256,
          source: "upload",
          filename: inputData.filename ?? null,
        }));
      await setDocumentStatus(db, doc.id, "processing");
      return { documentId: doc.id, text: inputData.text };
    },
  });

  const extract = createStep({
    id: "extract",
    inputSchema: z.object({ documentId: z.string(), text: z.string() }),
    outputSchema: ExtractedSchema,
    execute: async ({ inputData, bail }) => {
      try {
        const { invoice, promptVersion } = await extractInvoiceFromText(
          inputData.text,
          model,
        );
        return { documentId: inputData.documentId, invoice, promptVersion };
      } catch (error) {
        await setDocumentStatus(db, inputData.documentId, "rejected");
        return bail({
          kind: "failed",
          documentId: inputData.documentId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  });

  const verify = createStep({
    id: "verify",
    inputSchema: ExtractedSchema,
    outputSchema: VerifiedSchema,
    execute: async ({ inputData }) => ({
      ...inputData,
      issues: checkTotals(inputData.invoice),
    }),
  });

  // Ask instead of guess: if any check fails, the run pauses (its state is
  // saved in Postgres) until a person approves or rejects the extraction.
  const humanReview = createStep({
    id: HUMAN_REVIEW_STEP_ID,
    inputSchema: VerifiedSchema,
    outputSchema: ReviewedSchema,
    suspendSchema: ReviewRequestSchema,
    resumeSchema: ReviewDecisionSchema,
    execute: async ({ inputData, resumeData, suspend }) => {
      const { issues, ...extracted } = inputData;
      if (issues.length === 0) {
        return { ...extracted, approved: true, reviewedBy: "rules" };
      }
      if (!resumeData) {
        await setDocumentStatus(db, extracted.documentId, "needs_review");
        return await suspend({
          documentId: extracted.documentId,
          issues,
          question:
            "The extracted numbers do not add up. Is the extraction faithful to the document?",
        });
      }
      return {
        ...extracted,
        approved: resumeData.approved,
        reviewedBy: resumeData.reviewer,
      };
    },
  });

  const persist = createStep({
    id: "persist",
    inputSchema: ReviewedSchema,
    outputSchema: OutcomeSchema,
    execute: async ({ inputData }) => {
      const { documentId, invoice, promptVersion, approved, reviewedBy } =
        inputData;
      if (!approved) {
        await setDocumentStatus(db, documentId, "rejected");
        return { kind: "rejected" as const, documentId, reviewedBy };
      }
      const invoiceId = await saveInvoice(
        db,
        documentId,
        invoice,
        promptVersion,
      );
      await setDocumentStatus(db, documentId, "valid");
      return {
        kind: "accepted" as const,
        documentId,
        invoiceId,
        totalCents: invoice.totalCents,
        reviewedBy,
      };
    },
  });

  return createWorkflow({
    id: "process-document",
    inputSchema: z.object({
      text: z.string(),
      filename: z.string().optional(),
    }),
    outputSchema: OutcomeSchema,
  })
    .then(ingest)
    .then(extract)
    .then(verify)
    .then(humanReview)
    .then(persist)
    .commit();
}
