import { describe, expect, it, vi } from "vitest";
import { createPromptResolver, type PromptSource } from "./index.js";

const env = { LANGFUSE_BASE_URL: "http://127.0.0.1:3000" };
const repair = { name: "repair", version: 1, text: "Repair the invoice." };

/** A registry that answers every request with the given prompt client. */
function fakeRegistry(answer: {
  prompt: string;
  version: number;
  isFallback: boolean;
}) {
  const get = vi.fn(async () => answer);
  const source: PromptSource = { get };
  return { source, get };
}

describe("createPromptResolver", () => {
  it("uses the local text without any call when tracing is off", async () => {
    const { source, get } = fakeRegistry({
      prompt: "x",
      version: 1,
      isFallback: false,
    });

    const resolved = await createPromptResolver({}, { source })(repair);

    expect(resolved).toEqual({ text: repair.text, link: undefined });
    expect(get).not.toHaveBeenCalled();
  });

  it("asks the registry for the pinned version and links to it", async () => {
    const { source, get } = fakeRegistry({
      prompt: repair.text,
      version: 1,
      isFallback: false,
    });

    const resolved = await createPromptResolver(env, { source })(repair);

    expect(resolved).toEqual({
      text: repair.text,
      link: { name: "repair", version: 1 },
    });
    expect(get).toHaveBeenCalledWith("repair", {
      type: "text",
      version: 1,
      fallback: repair.text,
      fetchTimeoutMs: 2000,
      maxRetries: 0,
    });
  });

  it("asks once per version and process", async () => {
    const { source, get } = fakeRegistry({
      prompt: repair.text,
      version: 1,
      isFallback: false,
    });
    const resolve = createPromptResolver(env, { source });

    await resolve(repair);
    await resolve(repair);

    expect(get).toHaveBeenCalledTimes(1);
  });

  it("falls back to the local text, unlinked, when the registry does not serve it", async () => {
    const { source } = fakeRegistry({
      prompt: repair.text,
      version: 0,
      isFallback: true,
    });

    const resolved = await createPromptResolver(env, { source })(repair);

    expect(resolved).toEqual({ text: repair.text, link: undefined });
  });

  it("falls back to the local text, unlinked, when the registry call throws", async () => {
    const source: PromptSource = {
      get: async () => {
        throw new Error("connection refused");
      },
    };
    const warn = vi.fn();

    const resolved = await createPromptResolver(env, { source, warn })(repair);

    expect(resolved).toEqual({ text: repair.text, link: undefined });
    expect(warn).toHaveBeenCalled();
  });

  it("keeps the local text on drift, warns, and still links the version", async () => {
    const { source } = fakeRegistry({
      prompt: "Edited in the Langfuse UI.",
      version: 1,
      isFallback: false,
    });
    const warn = vi.fn();

    const resolved = await createPromptResolver(env, { source, warn })(repair);

    expect(resolved).toEqual({
      text: repair.text,
      link: { name: "repair", version: 1 },
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("repair v1"));
  });
});
