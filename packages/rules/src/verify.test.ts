import type { Invoice, InvoiceLine } from "@invariant/schema";
import { describe, expect, it } from "vitest";
import { verifyInvoice } from "./verify.js";

function line(overrides: Partial<InvoiceLine> = {}): InvoiceLine {
  return {
    description: "Item",
    quantity: 1,
    unitPriceCents: 1000,
    lineTotalCents: 1000,
    vatRateBps: 2100,
    ...overrides,
  };
}

/** The day-4 fixture: oil at 10 % and flour at 4 %; every rule holds. */
const valid: Invoice = {
  number: "F-2026-0042",
  issueDate: "2026-09-24",
  currency: "EUR",
  supplier: { name: "Aceites García SL", taxId: "B12345674" },
  customer: { name: "Restaurante Sol" },
  lines: [
    line({
      quantity: 2,
      unitPriceCents: 3000,
      lineTotalCents: 6000,
      vatRateBps: 1000,
    }),
    line({
      quantity: 1.5,
      unitPriceCents: 200,
      lineTotalCents: 300,
      vatRateBps: 400,
    }),
  ],
  taxBaseCents: 6300,
  vatAmountCents: 612,
  totalCents: 6912,
};

const TODAY = "2026-09-24";
const ruleIds = (inv: Invoice) =>
  verifyInvoice(inv, { today: TODAY }).violations.map((v) => v.ruleId);

describe("verifyInvoice", () => {
  it("accepts an invoice where every rule holds, with a score of 1", () => {
    const result = verifyInvoice(valid, { today: TODAY });
    expect(result.violations).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.score).toBe(1);
  });

  describe("line amounts", () => {
    it("flags a line whose total is not quantity × unit price", () => {
      const inv = {
        ...valid,
        lines: [
          valid.lines[0] as InvoiceLine,
          line({ ...valid.lines[1], lineTotalCents: 350 }),
        ],
      };
      const result = verifyInvoice(inv, { today: TODAY });
      expect(result.violations).toContainEqual(
        expect.objectContaining({
          ruleId: "line-amount",
          path: "lines[1].lineTotalCents",
        }),
      );
    });

    it("tolerates one cent of rounding on a line", () => {
      // 3 × 3,333 € = 9,999 € → printed as 10,00 €
      const inv: Invoice = {
        ...valid,
        lines: [
          line({
            quantity: 3,
            unitPriceCents: 333,
            lineTotalCents: 1000,
            vatRateBps: 2100,
          }),
        ],
        taxBaseCents: 1000,
        vatAmountCents: 210,
        totalCents: 1210,
      };
      expect(ruleIds(inv)).not.toContain("line-amount");
    });

    it("is only a warning, because line discounts are not modelled yet", () => {
      const inv = {
        ...valid,
        lines: [
          line({ ...valid.lines[0], lineTotalCents: 5400 }),
          valid.lines[1] as InvoiceLine,
        ],
        taxBaseCents: 5700,
        vatAmountCents: 552,
        totalCents: 6252,
      };
      const result = verifyInvoice(inv, { today: TODAY });
      expect(result.violations.map((v) => [v.ruleId, v.severity])).toEqual([
        ["line-amount", "warning"],
      ]);
      expect(result.valid).toBe(true);
    });
  });

  it("tolerates half a cent per line, as real invoicing software rounds the base once", () => {
    // Printed by FacturaScripts: lines 87,84 € but base 87,83 € (13,2 × 2,33 = 30,756 € shown as 30,76 €).
    const lines = [
      line({
        quantity: 3,
        unitPriceCents: 140,
        lineTotalCents: 420,
        vatRateBps: 400,
      }),
      line({
        quantity: 3,
        unitPriceCents: 213,
        lineTotalCents: 639,
        vatRateBps: 1000,
      }),
      line({
        quantity: 3,
        unitPriceCents: 117,
        lineTotalCents: 351,
        vatRateBps: 400,
      }),
      line({
        quantity: 1.5,
        unitPriceCents: 1002,
        lineTotalCents: 1503,
        vatRateBps: 1000,
      }),
      line({
        quantity: 13.2,
        unitPriceCents: 233,
        lineTotalCents: 3076,
        vatRateBps: 400,
      }),
      line({
        quantity: 13.5,
        unitPriceCents: 207,
        lineTotalCents: 2795,
        vatRateBps: 400,
      }),
    ];
    const inv = {
      ...valid,
      lines,
      taxBaseCents: 8783,
      vatAmountCents: 480,
      totalCents: 9263,
    };
    expect(ruleIds(inv)).toEqual([]);
  });

  it("still flags a gap larger than the rounding of its lines", () => {
    const inv = {
      ...valid,
      taxBaseCents: 6302,
      vatAmountCents: 612,
      totalCents: 6914,
    };
    expect(ruleIds(inv)).toContain("lines-sum");
  });

  it("flags lines that do not add up to the tax base", () => {
    expect(
      ruleIds({ ...valid, taxBaseCents: 6400, totalCents: 7012 }),
    ).toContain("lines-sum");
  });

  describe("VAT rates", () => {
    it("rejects a rate that does not exist in Spain", () => {
      const inv = {
        ...valid,
        lines: [line({ vatRateBps: 1600 })],
        taxBaseCents: 1000,
        vatAmountCents: 160,
        totalCents: 1160,
      };
      expect(ruleIds(inv)).toEqual(["vat-rate"]);
    });

    it("accepts 0 % (exempt operations)", () => {
      const inv = {
        ...valid,
        lines: [line({ vatRateBps: 0 })],
        taxBaseCents: 1000,
        vatAmountCents: 0,
        totalCents: 1000,
      };
      expect(ruleIds(inv)).toEqual([]);
    });

    it("accepts the temporary 5 % rate only before 2025", () => {
      const at5 = {
        ...valid,
        lines: [line({ vatRateBps: 500 })],
        taxBaseCents: 1000,
        vatAmountCents: 50,
        totalCents: 1050,
      };
      expect(ruleIds({ ...at5, issueDate: "2024-06-01" })).toEqual([]);
      expect(ruleIds({ ...at5, issueDate: "2025-02-01" })).toEqual([
        "vat-rate",
      ]);
    });
  });

  describe("VAT amount", () => {
    it("flags a VAT amount that is not the sum of base × rate per rate", () => {
      expect(
        ruleIds({ ...valid, vatAmountCents: 630, totalCents: 6930 }),
      ).toEqual(["vat-amount"]);
    });

    it("rounds per rate group, as Spanish invoices print one VAT line per rate", () => {
      // Two 21 % lines of 0,05 €: per-line VAT would be 0,01 + 0,01 = 0,02 €, but the group
      // base is 0,10 € → 0,021 € → 0,02 €. Three lines of 0,05 € → 0,15 € → 0,0315 € → 0,03 €.
      const inv = {
        ...valid,
        lines: [1, 2, 3].map(() =>
          line({ unitPriceCents: 5, lineTotalCents: 5 }),
        ),
        taxBaseCents: 15,
        vatAmountCents: 3,
        totalCents: 18,
      };
      expect(ruleIds(inv)).toEqual([]);
    });
  });

  describe("total", () => {
    it("flags a total that is not base + VAT − withholding", () => {
      expect(ruleIds({ ...valid, totalCents: 7012 })).toEqual(["total"]);
    });

    it("subtracts the withholding (IRPF) when present", () => {
      expect(
        ruleIds({ ...valid, withholdingCents: 945, totalCents: 6912 - 945 }),
      ).toEqual([]);
    });
  });

  it("does not crash on an invoice without lines; header rules still run", () => {
    const result = verifyInvoice(
      { ...valid, lines: [], totalCents: 1 },
      { today: TODAY },
    );
    expect(result.violations.map((v) => v.ruleId)).toEqual([
      "lines-sum",
      "vat-amount",
      "total",
    ]);
  });

  it("scores the share of rules that passed, for evals and as an RL reward", () => {
    const result = verifyInvoice(
      { ...valid, totalCents: 7012 },
      { today: TODAY },
    );
    expect(result.valid).toBe(false);
    expect(result.score).toBeCloseTo(6 / 7);
  });

  describe("tax ids", () => {
    it("requires the supplier's tax id (Spanish invoicing regulation, RD 1619/2012)", () => {
      expect(
        ruleIds({ ...valid, supplier: { name: "Aceites García SL" } }),
      ).toEqual(["tax-ids"]);
    });

    it("rejects a supplier tax id with a wrong check character", () => {
      const result = verifyInvoice(
        { ...valid, supplier: { name: "X", taxId: "B12345678" } },
        { today: TODAY },
      );
      expect(result.violations).toEqual([
        expect.objectContaining({ ruleId: "tax-ids", path: "supplier.taxId" }),
      ]);
    });

    it("checks the customer's tax id only when present (simplified invoices omit it)", () => {
      expect(ruleIds({ ...valid, customer: { name: "Cliente" } })).toEqual([]);
      expect(
        ruleIds({ ...valid, customer: { name: "C", taxId: "12345678A" } }),
      ).toEqual(["tax-ids"]);
    });
  });

  describe("issue date", () => {
    it("rejects an invoice dated in the future", () => {
      expect(ruleIds({ ...valid, issueDate: "2026-09-25" })).toEqual([
        "issue-date",
      ]);
    });

    it("accepts an invoice dated today", () => {
      expect(ruleIds({ ...valid, issueDate: TODAY })).toEqual([]);
    });
  });
});
