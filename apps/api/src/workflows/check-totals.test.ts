import type { Invoice } from "@invariant/schema";
import { describe, expect, it } from "vitest";
import { checkTotals } from "./check-totals.js";

const consistent: Invoice = {
  number: "F-1",
  issueDate: "2026-09-24",
  currency: "EUR",
  supplier: { name: "Proveedor SL" },
  customer: { name: "Cliente SL" },
  lines: [
    {
      description: "A",
      quantity: 2,
      unitPriceCents: 3000,
      lineTotalCents: 6000,
      vatRateBps: 1000,
    },
    {
      description: "B",
      quantity: 1.5,
      unitPriceCents: 200,
      lineTotalCents: 300,
      vatRateBps: 400,
    },
  ],
  taxBaseCents: 6300,
  vatAmountCents: 612,
  totalCents: 6912,
};

describe("checkTotals", () => {
  it("returns no issues for a consistent invoice", () => {
    expect(checkTotals(consistent)).toEqual([]);
  });

  it("flags lines that do not add up to the tax base", () => {
    const issues = checkTotals({ ...consistent, taxBaseCents: 6400 });
    expect(issues.map((i) => i.code)).toContain("LINES_SUM_MISMATCH");
  });

  it("flags a total that is not base + VAT − withholding", () => {
    const issues = checkTotals({ ...consistent, totalCents: 7012 });
    expect(issues).toEqual([
      {
        code: "TOTAL_MISMATCH",
        message: "Total is 70,12 € but base + VAT − withholding is 69,12 €.",
      },
    ]);
  });

  it("subtracts the withholding when it is present", () => {
    const withWithholding = {
      ...consistent,
      withholdingCents: 945,
      totalCents: 6912 - 945,
    };
    expect(checkTotals(withWithholding)).toEqual([]);
  });
});
