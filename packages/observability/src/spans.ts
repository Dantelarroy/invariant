import {
  type AnySpan,
  SpanType,
  type TracingContext,
} from "@mastra/core/observability";

/** How a document run ended; set on its trace as metadata and as a tag. */
export const BRANCHES = [
  "accepted",
  "repaired",
  "needs_review",
  "failed",
  "rejected",
  "duplicate",
] as const;
export type Branch = (typeof BRANCHES)[number];

/** What a traced model call returns: the extractor's ExtractionResult fits. */
export interface GenerationResult {
  modelId: string;
  usage: { inputTokens: number | undefined; outputTokens: number | undefined };
}

/** Tracing must never change what a run does: a tracing failure is only logged. */
function safely<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch (error) {
    console.warn("[observability] tracing error ignored:", error);
    return undefined;
  }
}

function rootOf(tracing: TracingContext | undefined): AnySpan | undefined {
  const current = tracing?.currentSpan;
  if (!current?.isValid) return undefined;
  if (current.isRootSpan) return current;
  return current.findParent(SpanType.WORKFLOW_RUN);
}

/**
 * Runs one model call inside a MODEL_GENERATION span named after the prompt
 * version. The span ends with the model id the provider answered with and the
 * input/output token totals (only totals: Langfuse infers the cost from them,
 * and sending reasoning tokens separately would count them twice). On failure
 * it ends with the error and the original error is rethrown.
 */
export async function withGeneration<T extends GenerationResult>(
  tracing: TracingContext | undefined,
  options: { name: string; model: string },
  call: () => Promise<T>,
): Promise<T> {
  const span = safely(() =>
    tracing?.currentSpan?.createChildSpan({
      type: SpanType.MODEL_GENERATION,
      name: options.name,
      attributes: { model: options.model },
      metadata: { promptVersion: options.name },
    }),
  );
  let result: T;
  try {
    result = await call();
  } catch (error) {
    safely(() =>
      span?.error({
        error: error instanceof Error ? error : new Error(String(error)),
        endSpan: true,
      }),
    );
    throw error;
  }
  safely(() =>
    span?.end({
      attributes: {
        model: result.modelId,
        usage: {
          ...(result.usage.inputTokens === undefined
            ? {}
            : { inputTokens: result.usage.inputTokens }),
          ...(result.usage.outputTokens === undefined
            ? {}
            : { outputTokens: result.usage.outputTokens }),
        },
      },
    }),
  );
  return result;
}

/** Merges metadata into the trace (the workflow run's root span). */
export function setTraceMetadata(
  tracing: TracingContext | undefined,
  metadata: Record<string, string | number | boolean>,
): void {
  safely(() => rootOf(tracing)?.update({ metadata }));
}

/**
 * Sets how the run ended, as trace metadata and as a tag. A later call
 * replaces the branch, so a trace never carries two.
 */
export function setBranch(
  tracing: TracingContext | undefined,
  branch: Branch,
): void {
  safely(() => {
    const root = rootOf(tracing);
    if (!root) return;
    root.update({ metadata: { branch } });
    const others = (root.tags ?? []).filter(
      (tag) => !(BRANCHES as readonly string[]).includes(tag),
    );
    root.tags = [...others, branch];
  });
}
