import { verifyInvoice } from "@invariant/rules";
import { InvoiceSchema } from "@invariant/schema";
import { describe, expect, it } from "vitest";
import { generateInvoice } from "./generate.js";

const SEEDS = Array.from({ length: 500 }, (_, i) => i + 1);

describe("generateInvoice", () => {
  it("is deterministic: the same seed gives the same invoice", () => {
    expect(generateInvoice(123)).toEqual(generateInvoice(123));
  });

  it("always produces a valid invoice that passes every business rule", () => {
    for (const seed of SEEDS) {
      const { invoice } = generateInvoice(seed);
      expect(InvoiceSchema.parse(invoice)).toEqual(invoice);
      const result = verifyInvoice(invoice, { today: "2026-09-24" });
      expect(result.violations, `seed ${seed}`).toEqual([]);
    }
  });

  it("covers the variety the extractor must handle", () => {
    const invoices = SEEDS.map((seed) => generateInvoice(seed));
    const rates = new Set(
      invoices.flatMap((s) => s.invoice.lines.map((l) => l.vatRateBps)),
    );
    expect(rates).toEqual(new Set([400, 1000, 2100]));
    expect(invoices.some((s) => s.invoice.withholdingCents !== undefined)).toBe(
      true,
    );
    expect(invoices.some((s) => s.invoice.customer.taxId === undefined)).toBe(
      true,
    );
    expect(
      invoices.some((s) =>
        s.invoice.lines.some((l) => !Number.isInteger(l.quantity)),
      ),
    ).toBe(true);
    expect(new Set(invoices.map((s) => s.template))).toEqual(
      new Set(["classic", "modern", "compact"]),
    );
  });
});
