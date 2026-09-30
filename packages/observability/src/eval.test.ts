import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { describe, expect, it } from "vitest";
import { createEvalTracer } from "./index.js";

const env = { LANGFUSE_BASE_URL: "http://127.0.0.1:3000" };
const meta = {
  dataset: "data/synth-erp",
  model: "gpt-5-mini",
  promptVersion: "extract-document-v2",
  repairPromptVersion: "repair-v1",
  prompts: { extract: { name: "extract-document", version: 2 } },
};
const item = {
  id: "erp-fs-000001",
  path: "/data/synth-erp/pdf/erp-fs-000001.pdf",
  mediaType: "application/pdf",
};
const extraction = {
  invoice: { number: "F-1", totalCents: 1210 },
  modelId: "gpt-5-mini-2025-08-07",
  promptVersion: "extract-document-v2",
  usage: { inputTokens: 1500, outputTokens: 900 },
};
const result = {
  score: {
    exactMatch: false,
    rules: { valid: false, failedRuleIds: ["total"] },
  },
};

/** Keeps its spans after shutdown (the base class clears them), so tests can read them. */
class KeepingExporter extends InMemorySpanExporter {
  override shutdown(): Promise<void> {
    return Promise.resolve();
  }
}

/** The spans the Langfuse processor would send, captured in memory. */
function tracedWithMemory() {
  const exporter = new KeepingExporter();
  const tracer = createEvalTracer(env, meta, { exporter });
  if (!tracer) throw new Error("tracing should be on");
  return { tracer, exporter };
}

describe("createEvalTracer", () => {
  it("is off without LANGFUSE_BASE_URL", () => {
    expect(createEvalTracer({}, meta)).toBeUndefined();
  });

  it("sends one trace per document with its generations and metadata, and no bytes", async () => {
    const { tracer, exporter } = tracedWithMemory();

    const trace = tracer.startDocument(item);
    await trace.generation("extract", async () => extraction);
    await trace.generation("repair", async () => ({
      ...extraction,
      promptVersion: "repair-v1",
    }));
    trace.end(result);
    await tracer.shutdown();

    const spans = exporter.getFinishedSpans();
    const root = spans.find((span) => span.name === item.id);
    const generations = spans.filter(
      (span) => span.attributes["langfuse.observation.type"] === "generation",
    );
    expect(new Set(spans.map((span) => span.spanContext().traceId)).size).toBe(
      1,
    );
    expect(root?.attributes).toMatchObject({
      "langfuse.environment": "eval",
      "langfuse.trace.name": item.id,
      "langfuse.trace.tags": ["eval"],
      "langfuse.trace.metadata.dataset": "data/synth-erp",
      "langfuse.trace.metadata.documentId": item.id,
      "langfuse.trace.metadata.model": "gpt-5-mini",
      "langfuse.trace.metadata.promptVersion": "extract-document-v2",
      "langfuse.trace.metadata.exactMatch": false,
      "langfuse.trace.metadata.ruleValid": false,
      "langfuse.trace.metadata.failedRules": "total",
    });
    expect(generations.map((span) => span.name)).toEqual([
      "extract-document-v2",
      "repair-v1",
    ]);
    expect(generations[0]?.attributes).toMatchObject({
      "langfuse.observation.model.name": "gpt-5-mini-2025-08-07",
      "langfuse.observation.usage_details": JSON.stringify({
        input: 1500,
        output: 900,
      }),
    });
    // Generations carry the prompt link (when the registry served it), input and output.
    expect(generations[0]?.attributes).toMatchObject({
      "langfuse.observation.prompt.name": "extract-document",
      "langfuse.observation.prompt.version": 2,
      "langfuse.observation.input": JSON.stringify({
        promptVersion: "extract-document-v2",
        file: "erp-fs-000001.pdf",
        mediaType: "application/pdf",
      }),
      "langfuse.observation.output": JSON.stringify(extraction.invoice),
    });
    expect(
      generations[1]?.attributes["langfuse.observation.prompt.name"],
    ).toBeUndefined();
    // The input names the file; the document itself never leaves the machine.
    expect(root?.attributes["langfuse.observation.input"]).toBe(
      JSON.stringify({
        file: "erp-fs-000001.pdf",
        mediaType: "application/pdf",
      }),
    );
    for (const span of spans) {
      expect(JSON.stringify(span.attributes)).not.toContain("JVBER"); // base64 "%PDF"
    }
  });

  it("ends a failed generation with the error and rethrows it", async () => {
    const { tracer, exporter } = tracedWithMemory();
    const failure = new Error("model timed out");

    const trace = tracer.startDocument(item);
    await expect(
      trace.generation("extract", async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    trace.end({ ...result, error: "model timed out" });
    await tracer.shutdown();

    const generation = exporter
      .getFinishedSpans()
      .find(
        (span) => span.attributes["langfuse.observation.type"] === "generation",
      );
    expect(generation?.attributes).toMatchObject({
      "langfuse.observation.level": "ERROR",
      "langfuse.observation.status_message": "model timed out",
    });
  });
});
