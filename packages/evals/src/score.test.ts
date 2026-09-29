import type { Invoice } from "@invariant/schema";
import { describe, expect, it } from "vitest";
import { SCORED_FIELDS, scoreExtraction } from "./score.js";

const TODAY = "2026-09-29";

/** A label that passes every business rule. */
const label: Invoice = {
  number: "F-2026-0042",
  issueDate: "2026-09-24",
  currency: "EUR",
  supplier: { name: "Aceites García SL", taxId: "B12345674" },
  customer: { name: "Restaurante Sol" },
  lines: [
    {
      description: "Aceite de oliva virgen extra 5 L",
      quantity: 2,
      unitPriceCents: 3000,
      lineTotalCents: 6000,
      vatRateBps: 1000,
    },
  ],
  taxBaseCents: 6000,
  vatAmountCents: 600,
  totalCents: 6600,
};

/** The same invoice with an IRPF withholding of 15 % on the base. */
const labelWithWithholding: Invoice = {
  ...label,
  withholdingCents: 900,
  totalCents: 5700,
};

const mismatchedFields = (score: ReturnType<typeof scoreExtraction>) =>
  SCORED_FIELDS.filter((field) => !score.fields[field].match);

describe("scoreExtraction", () => {
  it("matches every scored field of a perfect extraction and marks it an exact match", () => {
    const score = scoreExtraction(label, structuredClone(label), {
      today: TODAY,
    });

    expect(mismatchedFields(score)).toEqual([]);
    expect(score.exactMatch).toBe(true);
    expect(score.rules).toEqual({ valid: true, failedRuleIds: [] });
  });

  it("scores the expected fields, including the number of lines", () => {
    const score = scoreExtraction(label, label, { today: TODAY });

    expect(Object.keys(score.fields).sort()).toEqual(
      [
        "number",
        "issueDate",
        "supplierTaxId",
        "customerTaxId",
        "taxBaseCents",
        "vatAmountCents",
        "withholdingCents",
        "totalCents",
        "lineCount",
      ].sort(),
    );
    expect(score.fields.lineCount).toEqual({
      expected: 1,
      actual: 1,
      match: true,
    });
  });

  it("reports only the total when it is off by one cent, with expected and actual values", () => {
    const score = scoreExtraction(
      label,
      { ...label, totalCents: 6601 },
      { today: TODAY },
    );

    expect(mismatchedFields(score)).toEqual(["totalCents"]);
    expect(score.fields.totalCents).toEqual({
      expected: 6600,
      actual: 6601,
      match: false,
    });
    expect(score.exactMatch).toBe(false);
  });

  it("matches tax ids and invoice numbers ignoring case, spaces, dots and hyphens", () => {
    const score = scoreExtraction(
      label,
      {
        ...label,
        number: "f 2026.0042",
        supplier: { ...label.supplier, taxId: "b-12345674" },
      },
      { today: TODAY },
    );

    expect(score.fields.supplierTaxId).toEqual({
      expected: "B12345674",
      actual: "b-12345674",
      match: true,
    });
    expect(score.fields.number.match).toBe(true);
    expect(score.exactMatch).toBe(true);
  });

  it("reports a withholding missing from the extraction as a mismatch", () => {
    const { withholdingCents: _, ...withoutWithholding } = labelWithWithholding;

    const score = scoreExtraction(labelWithWithholding, withoutWithholding, {
      today: TODAY,
    });

    expect(score.fields.withholdingCents).toEqual({
      expected: 900,
      actual: undefined,
      match: false,
    });
    expect(score.exactMatch).toBe(false);
  });

  it("counts a field absent in both the label and the extraction as a match", () => {
    const score = scoreExtraction(label, label, { today: TODAY });

    expect(score.fields.withholdingCents).toEqual({
      expected: undefined,
      actual: undefined,
      match: true,
    });
    expect(score.fields.customerTaxId.match).toBe(true);
  });

  it("reports mismatched fields next to a passing rule verdict for a wrong but consistent extraction", () => {
    // Misreads the unit price as 35,00 €, and carries the error through every sum.
    const wrong: Invoice = {
      ...label,
      lines: label.lines.map((line) => ({
        ...line,
        unitPriceCents: 3500,
        lineTotalCents: 7000,
      })),
      taxBaseCents: 7000,
      vatAmountCents: 700,
      totalCents: 7700,
    };

    const score = scoreExtraction(label, wrong, { today: TODAY });

    expect(mismatchedFields(score)).toEqual([
      "taxBaseCents",
      "vatAmountCents",
      "totalCents",
    ]);
    expect(score.exactMatch).toBe(false);
    expect(score.rules).toEqual({ valid: true, failedRuleIds: [] });
  });

  it("reports the ids of the rules an extraction fails", () => {
    const score = scoreExtraction(
      label,
      { ...label, totalCents: 6601 },
      { today: TODAY },
    );

    expect(score.rules).toEqual({ valid: false, failedRuleIds: ["total"] });
  });

  it("scores a failed extraction as a mismatch on every field, even fields absent in the label", () => {
    const score = scoreExtraction(label, null, { today: TODAY });

    expect(mismatchedFields(score)).toEqual([...SCORED_FIELDS]);
    expect(score.fields.withholdingCents).toEqual({
      expected: undefined,
      actual: undefined,
      match: false,
    });
    expect(score.exactMatch).toBe(false);
    expect(score.rules).toEqual({ valid: false, failedRuleIds: [] });
  });
});
