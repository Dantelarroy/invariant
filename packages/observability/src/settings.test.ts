import { Observability } from "@mastra/observability";
import { describe, expect, it } from "vitest";
import { createObservability, langfuseSettings } from "./index.js";

describe("langfuseSettings", () => {
  it("is off without LANGFUSE_BASE_URL", () => {
    expect(langfuseSettings({})).toBeUndefined();
    expect(langfuseSettings({ LANGFUSE_BASE_URL: "" })).toBeUndefined();
  });

  it("points at LANGFUSE_BASE_URL with the local-only keys by default", () => {
    expect(
      langfuseSettings({ LANGFUSE_BASE_URL: "http://127.0.0.1:3000" }),
    ).toEqual({
      baseUrl: "http://127.0.0.1:3000",
      publicKey: "pk-lf-invariant-local-only",
      secretKey: "sk-lf-invariant-local-only",
    });
  });

  it("lets LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY override the keys", () => {
    expect(
      langfuseSettings({
        LANGFUSE_BASE_URL: "http://langfuse.test",
        LANGFUSE_PUBLIC_KEY: "pk-lf-other",
        LANGFUSE_SECRET_KEY: "sk-lf-other",
      }),
    ).toEqual({
      baseUrl: "http://langfuse.test",
      publicKey: "pk-lf-other",
      secretKey: "sk-lf-other",
    });
  });
});

describe("createObservability", () => {
  it("returns undefined without LANGFUSE_BASE_URL, so nothing is registered", () => {
    expect(createObservability({}, { environment: "pipeline" })).toBe(
      undefined,
    );
  });

  it("returns a Mastra observability config with LANGFUSE_BASE_URL", async () => {
    const observability = createObservability(
      { LANGFUSE_BASE_URL: "http://127.0.0.1:3000" },
      { environment: "pipeline" },
    );
    expect(observability).toBeInstanceOf(Observability);
    await observability?.shutdown();
  });
});
