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
  EXTRACT_TEXT_PROMPT,
  EXTRACT_TEXT_PROMPT_VERSION,
  extractInvoiceFromText,
  REPAIR_PROMPT,
  REPAIR_PROMPT_VERSION,
  repairInvoice,
  shouldUseRepair,
} from "@invariant/extractor";
import {
  type GenerationRef,
  type PromptResolver,
  type ReviewQueueSink,
  type ScoreSink,
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
    /** Present (true) when the reviewer's corrected invoice was stored (ADR-0013). */
    corrected: z.literal(true).optional(),
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

/**
 * What the reviewer answers to resume the run. `invoice` is the reviewer's
 * corrected invoice (ADR-0013): on approval it is stored instead of the
 * extraction; on rejection it is ignored. Optional, so terminal reviews and
 * runs paused before it existed resume as before.
 */
export const ReviewDecisionSchema = z.object({
  approved: z.boolean(),
  reviewer: z.string().min(1),
  invoice: InvoiceSchema.optional(),
});
export type ReviewDecision = z.infer<typeof ReviewDecisionSchema>;

const WorkflowInputSchema = z.object({
  text: z.string(),
  filename: z.string().optional(),
});

/** Where the extraction's generation is in Langfuse (tracing on only), for its scores. */
const GenerationRefSchema = z.object({
  traceId: z.string(),
  observationId: z.string(),
});

const ExtractedSchema = z.object({
  documentId: z.string(),
  invoice: InvoiceSchema,
  promptVersion: z.string(),
  generation: GenerationRefSchema.optional(),
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
  /** True when `invoice` is the reviewer's correction, not the extraction. */
  corrected: z.boolean().default(false),
});

const errorCount = (issues: readonly { severity: string }[]) =>
  issues.filter((issue) => issue.severity === "error").length;

/** Without a registry, every prompt is the local text, unlinked. */
const localPrompts: PromptResolver = async (prompt) => ({
  text: prompt.text,
  link: undefined,
});

/**
 * ingest → extract → verify → repair → human-review → persist.
 * Dependencies are injected so tests can pass a mock model and a test database.
 *
 * When tracing is on (ADR-0011), each model call is a generation span, linked
 * to its registry prompt and carrying its input and output, each verified
 * generation gets the rule results as scores (ADR-0012), and the step that
 * ends the run sets its branch on the trace. With tracing off, every
 * tracing call is a no-op.
 */
export function createProcessDocumentWorkflow(deps: {
  db: Db;
  model: LanguageModel;
  /** Resolves the pinned prompt versions (see @invariant/observability). */
  resolvePrompt?: PromptResolver | undefined;
  /** Sends rule results as scores of the verified generation (ADR-0012). */
  scores?: ScoreSink | undefined;
  /** Queues the generation of a paused run for review in Langfuse (ADR-0013). */
  reviewQueue?: ReviewQueueSink | undefined;
}) {
  const { db, model } = deps;
  const resolvePrompt = deps.resolvePrompt ?? localPrompts;
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
        const prompt = await resolvePrompt(EXTRACT_TEXT_PROMPT);
        const {
          result: { invoice, promptVersion },
          generation,
        } = await withGeneration(
          tracingContext,
          {
            name: EXTRACT_TEXT_PROMPT_VERSION,
            model: modelId,
            prompt: prompt.link,
            input: {
              promptVersion: EXTRACT_TEXT_PROMPT_VERSION,
              source: inputData.text,
            },
            output: (result) => result.invoice,
          },
          () =>
            extractInvoiceFromText(inputData.text, model, {
              instructions: prompt.text,
            }),
        );
        setTraceMetadata(tracingContext, { promptVersion });
        return {
          documentId: inputData.documentId,
          invoice,
          promptVersion,
          ...(generation ? { generation } : {}),
        };
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
    execute: async ({ inputData }) => {
      const verification = verifyInvoice(inputData.invoice);
      if (inputData.generation) {
        deps.scores?.ruleScores(inputData.generation, verification);
      }
      return { ...inputData, issues: verification.violations };
    },
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
      let generation: GenerationRef | undefined;
      try {
        const prompt = await resolvePrompt(REPAIR_PROMPT);
        ({ result: repaired, generation } = await withGeneration(
          tracingContext,
          {
            name: REPAIR_PROMPT_VERSION,
            model: modelId,
            prompt: prompt.link,
            input: { promptVersion: REPAIR_PROMPT_VERSION, source: text },
            output: (result) => result.invoice,
          },
          () =>
            repairInvoice({ text }, inputData.issues, model, {
              instructions: prompt.text,
            }),
        ));
      } catch {
        // A failed repair call is not a failed document: a person still reviews it.
        return original;
      }
      const verification = verifyInvoice(repaired.invoice);
      // Scored whether or not it is used: the repair has its own result.
      if (generation) deps.scores?.ruleScores(generation, verification);
      const issues = verification.violations;
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
        // The reviewer corrects the extraction that was chosen.
        ...(generation ? { generation } : {}),
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
        return {
          ...extracted,
          approved: true,
          reviewedBy: "rules",
          corrected: false,
        };
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
        // First suspend only (a resume carries resumeData). Tracing off means no
        // generation and no queue; a queue failure is logged, never thrown.
        if (extracted.generation && deps.reviewQueue) {
          try {
            deps.reviewQueue.enqueue(extracted.generation);
            setTraceMetadata(tracingContext, { queued: true });
          } catch (error) {
            console.warn("[review] could not queue for review:", error);
          }
        }
        return await suspend(request);
      }
      // A correction only counts when the reviewer approves (ADR-0013).
      const correction = resumeData.approved ? resumeData.invoice : undefined;
      return {
        ...extracted,
        ...(correction ? { invoice: correction } : {}),
        approved: resumeData.approved,
        reviewedBy: resumeData.reviewer,
        corrected: correction !== undefined,
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
        corrected,
      } = inputData;
      // A resumed run starts its own trace at human-review, after ingest.
      setTraceMetadata(tracingContext, { documentId, promptVersion });
      if (!approved) {
        await setDocumentStatus(db, documentId, "rejected");
        setBranch(tracingContext, "rejected");
        return { kind: "rejected" as const, documentId, reviewedBy };
      }
      if (corrected) {
        // The golden invoice is "as printed" (ADR-0013): a correction that still
        // breaks a rule is stored, and the rule result is only recorded.
        const { valid, violations } = verifyInvoice(invoice);
        setTraceMetadata(tracingContext, {
          corrected: true,
          correctedRulesValid: valid,
        });
        if (!valid) {
          console.warn(
            `[review] corrected invoice of ${documentId} still breaks: ${violations
              .filter((v) => v.severity === "error")
              .map((v) => v.ruleId)
              .join(", ")}`,
          );
        }
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
        ...(corrected ? { corrected: true as const } : {}),
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
