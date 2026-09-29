import { describe, expect, it } from "vitest";
import { checkDocuments } from "./check.js";
import { twoRates, withIrpf } from "./test-fixtures.js";
import type { ValidationResult } from "./validate.js";

const { taxId: _, ...privateCustomer } = twoRates.customer;
const finding = (ruleId: string, severity: string) => ({
  ruleId,
  severity,
  message: `${ruleId} message`,
});

describe("checkDocuments", () => {
  it("counts valid, refused and invalid documents and groups findings by rule", async () => {
    const answers: Record<string, ValidationResult> = {
      "F-2026-0042": {
        valid: false,
        errors: [finding("BR-CO-13", "fatal")],
        warnings: [],
      },
      F2025A1: {
        valid: true,
        errors: [],
        warnings: [finding("UBL-CR-513", "warning")],
      },
    };
    const seen: string[] = [];
    const report = await checkDocuments(
      [
        { id: "a", invoice: twoRates },
        { id: "b", invoice: withIrpf },
        { id: "c", invoice: { ...twoRates, customer: privateCustomer } },
        { id: "d", invoice: { ...withIrpf, number: "F-2026-0042" } },
      ],
      async (xml) => {
        const number = /<cbc:ID>([^<]+)</.exec(xml)?.[1] as string;
        return answers[number] as ValidationResult;
      },
      { onResult: (r) => seen.push(`${r.id}:${r.status}`) },
    );

    expect(seen).toEqual(["a:invalid", "b:valid", "c:refused", "d:invalid"]);
    expect(report).toEqual({
      documents: 4,
      valid: 1,
      refused: 1,
      invalid: 2,
      refusals: [
        {
          reason: "The buyer tax id is required for a B2B e-invoice.",
          count: 1,
          examples: ["c"],
        },
      ],
      errors: [{ ruleId: "BR-CO-13", count: 2, examples: ["a", "d"] }],
      warnings: [{ ruleId: "UBL-CR-513", count: 1, examples: ["b"] }],
    });
  });

  it("counts a rule once per document and keeps at most three examples, most frequent first", async () => {
    const report = await checkDocuments(
      ["a", "b", "c", "d"].map((id) => ({ id, invoice: twoRates })),
      async () => ({
        valid: false,
        errors: [
          finding("BR-CO-13", "fatal"),
          finding("BR-CO-13", "fatal"),
          finding("BR-CO-15", "fatal"),
        ],
        warnings: [],
      }),
    );
    expect(report.errors).toEqual([
      { ruleId: "BR-CO-13", count: 4, examples: ["a", "b", "c"] },
      { ruleId: "BR-CO-15", count: 4, examples: ["a", "b", "c"] },
    ]);
  });
});
