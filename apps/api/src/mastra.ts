import type { Db } from "@invariant/db";
import type {
  PromptResolver,
  ReviewQueueSink,
  ScoreSink,
} from "@invariant/observability";
import { Mastra } from "@mastra/core";
import type { ObservabilityEntrypoint } from "@mastra/core/observability";
import { PostgresStore } from "@mastra/pg";
import type { LanguageModel } from "ai";
import type { z } from "zod";
import {
  createProcessDocumentWorkflow,
  HUMAN_REVIEW_STEP_ID,
  type Outcome,
  type ReviewDecision,
  ReviewRequestSchema,
} from "./workflows/process-document.js";

/**
 * Mastra keeps workflow snapshots (the state of paused runs) in the same
 * Postgres, in its own "mastra" schema so its tables never mix with ours.
 * With `observability` (see @invariant/observability), every run is traced;
 * `resolvePrompt` links its generations to the prompt registry and `scores`
 * records their rule results (ADR-0012); `reviewQueue` sends paused runs to
 * the Langfuse review queue (ADR-0013).
 */
export function createInvariantMastra(deps: {
  db: Db;
  model: LanguageModel;
  databaseUrl: string;
  observability?: ObservabilityEntrypoint | undefined;
  resolvePrompt?: PromptResolver | undefined;
  scores?: ScoreSink | undefined;
  reviewQueue?: ReviewQueueSink | undefined;
}) {
  const storage = new PostgresStore({
    id: "invariant-workflows",
    connectionString: deps.databaseUrl,
    schemaName: "mastra",
  });
  const mastra = new Mastra({
    storage,
    logger: false,
    workflows: { processDocument: createProcessDocumentWorkflow(deps) },
    ...(deps.observability ? { observability: deps.observability } : {}),
  });
  // Pending scores and queue items first, then shutdown() flushes traces and
  // closes the storage.
  const close = async () => {
    await deps.scores?.flush();
    await deps.reviewQueue?.flush();
    await mastra.shutdown();
  };
  return { mastra, close };
}

export type InvariantMastra = ReturnType<
  typeof createInvariantMastra
>["mastra"];

export type RunResult =
  | Outcome
  | {
      kind: "needs_review";
      runId: string;
      documentId: string;
      issues: z.infer<typeof ReviewRequestSchema>["issues"];
      question: string;
    };

type WorkflowResult = Awaited<
  ReturnType<
    Awaited<
      ReturnType<ReturnType<InvariantMastra["getWorkflow"]>["createRun"]>
    >["start"]
  >
>;

function toRunResult(runId: string, result: WorkflowResult): RunResult {
  if (result.status === "success") return result.result;
  if (result.status === "suspended") {
    const request = ReviewRequestSchema.parse(
      result.suspendPayload[HUMAN_REVIEW_STEP_ID],
    );
    return { kind: "needs_review", runId, ...request };
  }
  throw new Error(`Workflow run ${runId} ended with status ${result.status}`);
}

/** Every workflow trace is tagged "pipeline"; its branch tag is added by the run. */
const PIPELINE_TAGS = ["pipeline"];

/** Starts processing a document. Returns the outcome, or a pending review. */
export async function processDocument(
  mastra: InvariantMastra,
  input: { text: string; filename?: string },
): Promise<RunResult> {
  const run = await mastra.getWorkflow("processDocument").createRun();
  return toRunResult(
    run.runId,
    await run.start({
      inputData: input,
      tracingOptions: {
        // The run id maps a queued generation back to its paused run (ADR-0013).
        metadata: {
          runId: run.runId,
          ...(input.filename ? { filename: input.filename } : {}),
        },
        tags: PIPELINE_TAGS,
      },
    }),
  );
}

/** Resumes a paused run with the reviewer's decision (works after restarts). */
export async function reviewDocument(
  mastra: InvariantMastra,
  runId: string,
  decision: ReviewDecision,
): Promise<RunResult> {
  const run = await mastra.getWorkflow("processDocument").createRun({ runId });
  return toRunResult(
    runId,
    await run.resume({
      step: HUMAN_REVIEW_STEP_ID,
      resumeData: decision,
      tracingOptions: { metadata: { resumed: true }, tags: PIPELINE_TAGS },
    }),
  );
}
