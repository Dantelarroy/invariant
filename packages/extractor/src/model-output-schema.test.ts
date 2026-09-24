import { describe, expect, it } from "vitest";
import { type ModelInvoice, toInvoice } from "./model-output-schema.js";

const output: ModelInvoice = {
  number: "F-1",
  issueDate: "2026-09-24",
  currency: "EUR",
  supplier: { name: "Proveedor SL", taxId: "B12345674" },
  customer: { name: "Cliente SL", taxId: null },
  lines: [
    {
      description: "Item",
      quantity: 1,
      unitPriceCents: 1000,
      lineTotalCents: 1000,
      vatRateBps: 2100,
    },
  ],
  taxBaseCents: 1000,
  vatAmountCents: 210,
  withholdingCents: null,
  totalCents: 1210,
};

describe("toInvoice", () => {
  it("drops null optional fields instead of keeping nulls", () => {
    const invoice = toInvoice(output);

    expect(invoice.customer).toEqual({ name: "Cliente SL" });
    expect("withholdingCents" in invoice).toBe(false);
    expect(invoice.supplier.taxId).toBe("B12345674");
  });

  it("keeps a present withholding amount", () => {
    expect(
      toInvoice({ ...output, withholdingCents: 150 }).withholdingCents,
    ).toBe(150);
  });

  it("still enforces the canonical schema (e.g. ISO dates)", () => {
    expect(() => toInvoice({ ...output, issueDate: "24/09/2026" })).toThrow();
  });
});
