import { basename } from "node:path";
import { LangfuseSpanProcessor } from "@langfuse/otel";
import {
  LangfuseOtelSpanAttributes,
  type LangfuseSpan,
  setLangfuseTracerProvider,
  startObservation,
} from "@langfuse/tracing";
import {
  BasicTracerProvider,
  type SpanExporter,
} from "@opentelemetry/sdk-trace-base";
import type { PromptLink } from "./prompts.js";
import { type Env, langfuseSettings } from "./settings.js";

/** What an eval run is: set on every trace as metadata. */
export interface EvalRunMeta {
  dataset: string;
  /** The model requested; each generation records the one that answered. */
  model: string;
  promptVersion: string;
  repairPromptVersion?: string;
  /** The registry prompts the run used, when the registry served them (ADR-0012). */
  prompts?: {
    extract?: PromptLink | undefined;
    repair?: PromptLink | undefined;
  };
}

/** A dataset document: only its id, file name and media type are traced. */
export interface EvalItem {
  id: string;
  path: string;
  mediaType: string;
}

/** What one model call returns (the extractor's ExtractionResult fits). */
export interface EvalGeneration {
  usage: { inputTokens: number | undefined; outputTokens: number | undefined };
  modelId?: string;
  promptVersion?: string;
  /** Recorded as the generation's output. */
  invoice?: unknown;
}

/** The part of an eval document result that goes on its trace. */
export interface EvalOutcome {
  score: {
    exactMatch: boolean;
    rules: { valid: boolean; failedRuleIds: string[] };
  };
  error?: string;
  repair?: { attempted: boolean; used: boolean };
}

export interface EvalDocumentTrace {
  generation<T extends EvalGeneration>(
    kind: "extract" | "repair",
    call: () => Promise<T>,
  ): Promise<T>;
  end(outcome: EvalOutcome): void;
}

export interface EvalTracer {
  startDocument(item: EvalItem): EvalDocumentTrace;
  /** Sends every pending trace; call it before the process exits. */
  shutdown(): Promise<void>;
}

const TRACE_METADATA = LangfuseOtelSpanAttributes.TRACE_METADATA;

function safely<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch (error) {
    console.warn("[observability] tracing error ignored:", error);
    return undefined;
  }
}

/**
 * Traces eval runs, which call the extractor directly rather than through
 * Mastra (ADR-0011): one trace per document in the `eval` environment, with a
 * generation per model call. Returns undefined when tracing is off.
 *
 * The trace input is the file name and media type, never the document bytes.
 * `options.exporter` replaces the Langfuse HTTP exporter (tests).
 */
export function createEvalTracer(
  env: Env,
  meta: EvalRunMeta,
  options: { exporter?: SpanExporter } = {},
): EvalTracer | undefined {
  const settings = langfuseSettings(env);
  if (!settings) return undefined;
  const processor = new LangfuseSpanProcessor({
    ...settings,
    environment: "eval",
    ...(options.exporter
      ? { exporter: options.exporter, exportMode: "immediate" as const }
      : {}),
  });
  // An isolated provider: nothing is registered globally.
  const provider = new BasicTracerProvider({ spanProcessors: [processor] });
  setLangfuseTracerProvider(provider);

  return {
    startDocument(item) {
      const input = { file: basename(item.path), mediaType: item.mediaType };
      const root = safely(() => {
        const span = startObservation(item.id, { input });
        span.otelSpan.setAttributes({
          [LangfuseOtelSpanAttributes.TRACE_NAME]: item.id,
          [LangfuseOtelSpanAttributes.TRACE_TAGS]: ["eval"],
          [`${TRACE_METADATA}.dataset`]: meta.dataset,
          [`${TRACE_METADATA}.documentId`]: item.id,
          [`${TRACE_METADATA}.model`]: meta.model,
          [`${TRACE_METADATA}.promptVersion`]: meta.promptVersion,
        });
        return span;
      });
      return {
        generation: (kind, call) =>
          traceGeneration(root, kind, call, { meta, input }),
        end(outcome) {
          safely(() => {
            if (!root) return;
            const { score, error, repair } = outcome;
            root.otelSpan.setAttributes({
              [`${TRACE_METADATA}.exactMatch`]: score.exactMatch,
              [`${TRACE_METADATA}.ruleValid`]: score.rules.valid,
              [`${TRACE_METADATA}.failedRules`]:
                score.rules.failedRuleIds.join(","),
              ...(repair
                ? {
                    [`${TRACE_METADATA}.repairAttempted`]: repair.attempted,
                    [`${TRACE_METADATA}.repairUsed`]: repair.used,
                  }
                : {}),
            });
            root.update({
              output: {
                exactMatch: score.exactMatch,
                rules: score.rules,
                ...(repair ? { repair } : {}),
                ...(error ? { error } : {}),
              },
              ...(error
                ? { level: "ERROR" as const, statusMessage: error }
                : {}),
            });
            root.end();
          });
        },
      };
    },
    async shutdown() {
      try {
        await provider.shutdown();
      } catch (error) {
        console.warn("[observability] could not send eval traces:", error);
      } finally {
        setLangfuseTracerProvider(null);
      }
    },
  };
}

async function traceGeneration<T extends EvalGeneration>(
  root: LangfuseSpan | undefined,
  kind: "extract" | "repair",
  call: () => Promise<T>,
  context: { meta: EvalRunMeta; input: { file: string; mediaType: string } },
): Promise<T> {
  const { meta, input } = context;
  const promptVersion =
    kind === "extract"
      ? meta.promptVersion
      : (meta.repairPromptVersion ?? "repair");
  const prompt = meta.prompts?.[kind];
  const generation = safely(() =>
    root?.startObservation(
      promptVersion,
      {
        model: meta.model,
        input: { promptVersion, ...input },
        ...(prompt ? { prompt: { ...prompt, isFallback: false } } : {}),
      },
      { asType: "generation" },
    ),
  );
  let result: T;
  try {
    result = await call();
  } catch (error) {
    safely(() => {
      generation?.update({
        level: "ERROR",
        statusMessage: error instanceof Error ? error.message : String(error),
      });
      generation?.end();
    });
    throw error;
  }
  safely(() => {
    if (!generation) return;
    if (result.promptVersion && result.promptVersion !== promptVersion) {
      generation.otelSpan.updateName(result.promptVersion);
    }
    // Only input and output totals: Langfuse infers the cost from them.
    const usageDetails: Record<string, number> = {};
    if (result.usage.inputTokens !== undefined)
      usageDetails.input = result.usage.inputTokens;
    if (result.usage.outputTokens !== undefined)
      usageDetails.output = result.usage.outputTokens;
    generation.update({
      model: result.modelId ?? meta.model,
      usageDetails,
      ...(result.invoice === undefined ? {} : { output: result.invoice }),
      ...(result.promptVersion
        ? { metadata: { promptVersion: result.promptVersion } }
        : {}),
    });
    generation.end();
  });
  return result;
}
