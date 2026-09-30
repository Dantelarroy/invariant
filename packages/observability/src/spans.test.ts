import { SpanType } from "@mastra/core/observability";
import {
  DefaultObservabilityInstance,
  TestExporter,
} from "@mastra/observability";
import { describe, expect, it } from "vitest";
import { setBranch, setTraceMetadata, withGeneration } from "./index.js";

/** A real Mastra span tree (run → step) exported to memory. */
function workflowStep() {
  const exporter = new TestExporter();
  const instance = new DefaultObservabilityInstance({
    name: "test",
    serviceName: "test",
    exporters: [exporter],
  });
  const run = instance.startSpan({
    type: SpanType.WORKFLOW_RUN,
    name: "workflow run",
    tracingOptions: { tags: ["pipeline"] },
  });
  const step = run.createChildSpan({
    type: SpanType.WORKFLOW_STEP,
    name: "step: extract",
  });
  return { exporter, run, step, tracingContext: { currentSpan: step } };
}

const result = {
  modelId: "gpt-5-mini-2025-08-07",
  usage: { inputTokens: 1200, outputTokens: 300 },
  invoice: { totalCents: 1210 },
};

describe("withGeneration", () => {
  it("records a generation named after the prompt version, with model and usage", async () => {
    const { exporter, run, step, tracingContext } = workflowStep();

    const returned = await withGeneration(
      tracingContext,
      { name: "extract-text-v1", model: "gpt-5-mini" },
      async () => result,
    );
    step.end();
    run.end();
    await exporter.flush();

    expect(returned).toBe(result);
    const [generation] = exporter.getSpansByType(SpanType.MODEL_GENERATION);
    expect(generation?.name).toBe("extract-text-v1");
    expect(generation?.parentSpanId).toBe(step.id);
    expect(generation?.endTime).toBeDefined();
    expect(generation?.attributes?.model).toBe("gpt-5-mini-2025-08-07");
    expect(generation?.attributes?.usage).toEqual({
      inputTokens: 1200,
      outputTokens: 300,
    });
    expect(generation?.metadata?.promptVersion).toBe("extract-text-v1");
  });

  it("ends the generation with the error and rethrows the original error", async () => {
    const { exporter, run, step, tracingContext } = workflowStep();
    const failure = new Error("model timed out");

    await expect(
      withGeneration(
        tracingContext,
        { name: "repair-v1", model: "gpt-5-mini" },
        async () => {
          throw failure;
        },
      ),
    ).rejects.toBe(failure);
    step.end();
    run.end();
    await exporter.flush();

    const [generation] = exporter.getSpansByType(SpanType.MODEL_GENERATION);
    expect(generation?.endTime).toBeDefined();
    expect(generation?.errorInfo?.message).toBe("model timed out");
  });

  it("just runs the call when tracing is off", async () => {
    expect(
      await withGeneration(
        undefined,
        { name: "extract-text-v1", model: "m" },
        async () => result,
      ),
    ).toBe(result);
  });
});

describe("setBranch", () => {
  it("writes the branch as metadata and as a tag on the root span", async () => {
    const { exporter, run, step, tracingContext } = workflowStep();

    setBranch(tracingContext, "needs_review");
    step.end();
    run.end();
    await exporter.flush();

    const [root] = exporter.getSpansByType(SpanType.WORKFLOW_RUN);
    expect(root?.metadata?.branch).toBe("needs_review");
    expect(root?.tags).toEqual(["pipeline", "needs_review"]);
  });

  it("replaces an earlier branch instead of adding a second one", () => {
    const { run, tracingContext } = workflowStep();

    setBranch(tracingContext, "needs_review");
    setBranch(tracingContext, "accepted");

    expect(run.metadata?.branch).toBe("accepted");
    expect(run.tags).toEqual(["pipeline", "accepted"]);
  });

  it("does nothing when tracing is off", () => {
    expect(() => setBranch(undefined, "failed")).not.toThrow();
    expect(() => setBranch({}, "failed")).not.toThrow();
  });
});

describe("setTraceMetadata", () => {
  it("merges metadata into the root span", () => {
    const { run, tracingContext } = workflowStep();

    setTraceMetadata(tracingContext, { documentId: "doc-1" });
    setTraceMetadata(tracingContext, { promptVersion: "extract-text-v1" });

    expect(run.metadata).toMatchObject({
      documentId: "doc-1",
      promptVersion: "extract-text-v1",
    });
  });
});
