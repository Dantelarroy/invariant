import { describe, expect, it } from "vitest";
import { planSeed } from "./index.js";

const text1 = { name: "extract-text", version: 1, text: "Text v1." };
const doc1 = { name: "extract-document", version: 1, text: "Document v1." };
const doc2 = { name: "extract-document", version: 2, text: "Document v2." };
const local = [text1, doc1, doc2];

describe("planSeed", () => {
  it("creates every version, each family in version order, on an empty registry", () => {
    expect(planSeed([doc2, text1, doc1], [])).toEqual({
      ok: true,
      actions: [
        { action: "create", prompt: doc1 },
        { action: "create", prompt: doc2 },
        { action: "create", prompt: text1 },
      ],
    });
  });

  it("skips versions registered with the same text, so a second run creates nothing", () => {
    const plan = planSeed(local, local);

    expect(plan.ok && plan.actions.map((a) => a.action)).toEqual([
      "skip",
      "skip",
      "skip",
    ]);
  });

  it("creates only the missing next version", () => {
    const plan = planSeed(local, [text1, doc1]);

    expect(plan.ok && plan.actions).toEqual([
      { action: "skip", prompt: doc1 },
      { action: "create", prompt: doc2 },
      { action: "skip", prompt: text1 },
    ]);
  });

  it("fails on drift, naming the prompt and version, and plans no write", () => {
    const edited = { ...doc1, text: "Edited in the UI." };

    expect(planSeed(local, [text1, edited])).toEqual({
      ok: false,
      errors: [expect.stringMatching(/extract-document version 1 .*differs/)],
    });
  });

  it("fails when Langfuse would number a new version differently", () => {
    // The registry has v1..v3 of the family but the code defines v1 and v2 only,
    // plus a v5 that Langfuse would register as v4.
    const doc3 = { ...doc2, version: 3, text: "Document v3." };
    const doc5 = { ...doc2, version: 5, text: "Document v5." };

    const plan = planSeed([doc1, doc2, doc5], [doc1, doc2, doc3]);

    expect(plan).toEqual({
      ok: false,
      errors: [expect.stringMatching(/extract-document version 5 .*4/)],
    });
  });

  it("fails on two definitions of the same version", () => {
    const plan = planSeed([doc1, { ...doc1, text: "Other." }], []);

    expect(plan.ok).toBe(false);
  });
});
