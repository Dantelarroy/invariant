import { createHash } from "node:crypto";
import {
  createDocument,
  type Db,
  findDocumentById,
  findDocumentBySha256,
  saveInvoice,
  setDocumentStatus,
} from "@invariant/db";
import {
  EXTRACT_TEXT_PROMPT_VERSION,
  extractInvoiceFromText,
  REPAIR_PROMPT_VERSION,
  repairInvoice,
  shouldUseRepair,
} from "@invariant/extractor";
import {
  setBranch,
  setStepOutput,
  setTraceMetadata,
  withGeneration,
} from "@invariant/observability";
import { verifyInvoice } from "@invariant/rules";
import { InvoiceSchema } from "@invariant/schema";
import { createStep, createWorkflow } from "@mastra/core/workflows";
import type { LanguageModel } from "ai";
import { z } from "zod";
import { buildReviewQuestion } from "../review/question.js";

export const HUMAN_REVIEW_STEP_ID = "human-review";

const IssueSchema = z.object({
  ruleId: z.string(),
  severity: z.enum(["error", "warning"]),
  message: z.string(),
  path: z.string().optional(),
  /** The values the rule compared (amounts in integer cents), see @invariant/rules. */
  details: z.record(z.string(), z.union([z.number(), z.string()])).optional(),
});

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
    /** True when the stored invoice came from the rule-guided repair (ADR-0010). */
    repaired: z.boolean(),
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

const WorkflowInputSchema = z.object({
  text: z.string(),
  filename: z.string().optional(),
});

const ExtractedSchema = z.object({
  documentId: z.string(),
  invoice: InvoiceSchema,
  promptVersion: z.string(),
});
const VerifiedSchema = ExtractedSchema.extend({ issues: z.array(IssueSchema) });
// Runs suspended before the repair step existed resume without `repaired`.
const RepairedSchema = VerifiedSchema.extend({
  repaired: z.boolean().default(false),
});
const ReviewedSchema = ExtractedSchema.extend({
  approved: z.boolean(),
  reviewedBy: z.string(),
  repaired: z.boolean(),
});

const errorCount = (issues: readonly { severity: string }[]) =>
  issues.filter((issue) => issue.severity === "error").length;

/**
 * ingest → extract → verify → repair → human-review → persist.
 * Dependencies are injected so tests can pass a mock model and a test database.
 *
 * When tracing is on (ADR-0011), each model call is a generation span and the
 * step that ends the run sets its branch on the trace. With tracing off, every
 * tracing call is a no-op.
 */
export function createProcessDocumentWorkflow(deps: {
  db: Db;
  model: LanguageModel;
}) {
  const { db, model } = deps;
  const modelId = typeof model === "string" ? model : model.modelId;

  // Idempotency: the same content (SHA-256) is processed only once,
  // unless it was rejected before, in which case it is retried.
  const ingest = createStep({
    id: "ingest",
    inputSchema: WorkflowInputSchema,
    outputSchema: z.object({ documentId: z.string(), text: z.string() }),
    execute: async ({ inputData, bail, tracingContext }) => {
      const sha256 = createHash("sha256").update(inputData.text).digest("hex");
      const existing = await findDocumentBySha256(db, sha256);
      if (existing && existing.status !== "rejected") {
        setTraceMetadata(tracingContext, {
          documentId: existing.id,
          model: modelId,
        });
        setBranch(tracingContext, "duplicate");
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
      setTraceMetadata(tracingContext, { documentId: doc.id, model: modelId });
      return { documentId: doc.id, text: inputData.text };
    },
  });

  const extract = createStep({
    id: "extract",
    inputSchema: z.object({ documentId: z.string(), text: z.string() }),
    outputSchema: ExtractedSchema,
    execute: async ({ inputData, bail, tracingContext }) => {
      try {
        const { invoice, promptVersion } = await withGeneration(
          tracingContext,
          { name: EXTRACT_TEXT_PROMPT_VERSION, model: modelId },
          () => extractInvoiceFromText(inputData.text, model),
        );
        setTraceMetadata(tracingContext, { promptVersion });
        return { documentId: inputData.documentId, invoice, promptVersion };
      } catch (error) {
        await setDocumentStatus(db, inputData.documentId, "rejected");
        setBranch(tracingContext, "failed");
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
      issues: verifyInvoice(inputData.invoice).violations,
    }),
  });

  // Repair once before asking (ADR-0010): when an error rule fails, the model gets
  // one clean-context retry with the violated rules. The repaired extraction is
  // used only when it has fewer errors; a tie keeps the original.
  const repair = createStep({
    id: "repair",
    inputSchema: VerifiedSchema,
    outputSchema: RepairedSchema,
    execute: async ({ inputData, getInitData, tracingContext }) => {
      const original = { ...inputData, repaired: false };
      if (errorCount(inputData.issues) === 0) return original;
      // Mastra resumes by step position, so a run suspended before this step existed
      // resumes here instead of at human-review. Its document is already waiting for
      // review: skip, so the decision applies to the extraction the reviewer saw.
      const document = await findDocumentById(db, inputData.documentId);
      if (document?.status === "needs_review") return original;
      // The source text comes from the run's input, so it is not copied into every step.
      const { text } = WorkflowInputSchema.parse(getInitData());
      let repaired: Awaited<ReturnType<typeof repairInvoice>>;
      try {
        repaired = await withGeneration(
          tracingContext,
          { name: REPAIR_PROMPT_VERSION, model: modelId },
          () => repairInvoice({ text }, inputData.issues, model),
        );
      } catch {
        // A failed repair call is not a failed document: a person still reviews it.
        return original;
      }
      const issues = verifyInvoice(repaired.invoice).violations;
      if (!shouldUseRepair(errorCount(inputData.issues), errorCount(issues))) {
        return original;
      }
      setTraceMetadata(tracingContext, {
        promptVersion: repaired.promptVersion,
      });
      return {
        documentId: inputData.documentId,
        invoice: repaired.invoice,
        promptVersion: repaired.promptVersion,
        issues,
        repaired: true,
      };
    },
  });

  // Ask instead of guess: if any rule fails with an error, the run pauses (its state is
  // saved in Postgres) until a person approves or rejects the extraction.
  const humanReview = createStep({
    id: HUMAN_REVIEW_STEP_ID,
    inputSchema: RepairedSchema,
    outputSchema: ReviewedSchema,
    suspendSchema: ReviewRequestSchema,
    resumeSchema: ReviewDecisionSchema,
    execute: async ({ inputData, resumeData, suspend, tracingContext }) => {
      const { issues, ...extracted } = inputData;
      // Warnings are kept in the run but only errors need a person.
      if (!issues.some((issue) => issue.severity === "error")) {
        return { ...extracted, approved: true, reviewedBy: "rules" };
      }
      if (!resumeData) {
        await setDocumentStatus(db, extracted.documentId, "needs_review");
        const request = {
          documentId: extracted.documentId,
          issues,
          question: buildReviewQuestion(issues),
        };
        // A suspended step ends without output: record the question on its span.
        setStepOutput(tracingContext, request);
        setBranch(tracingContext, "needs_review");
        return await suspend(request);
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
    execute: async ({ inputData, tracingContext }) => {
      const {
        documentId,
        invoice,
        promptVersion,
        approved,
        reviewedBy,
        repaired,
      } = inputData;
      // A resumed run starts its own trace at human-review, after ingest.
      setTraceMetadata(tracingContext, { documentId, promptVersion });
      if (!approved) {
        await setDocumentStatus(db, documentId, "rejected");
        setBranch(tracingContext, "rejected");
        return { kind: "rejected" as const, documentId, reviewedBy };
      }
      const invoiceId = await saveInvoice(
        db,
        documentId,
        invoice,
        promptVersion,
      );
      await setDocumentStatus(db, documentId, "valid");
      setBranch(tracingContext, repaired ? "repaired" : "accepted");
      return {
        kind: "accepted" as const,
        documentId,
        invoiceId,
        totalCents: invoice.totalCents,
        reviewedBy,
        repaired,
      };
    },
  });

  return createWorkflow({
    id: "process-document",
    inputSchema: WorkflowInputSchema,
    outputSchema: OutcomeSchema,
  })
    .then(ingest)
    .then(extract)
    .then(verify)
    .then(repair)
    .then(humanReview)
    .then(persist)
    .commit();
}
