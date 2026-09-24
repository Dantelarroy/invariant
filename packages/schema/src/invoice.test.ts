import { describe, expect, it } from "vitest";
import { type Invoice, InvoiceSchema } from "./invoice.js";

const validInvoice: Invoice = {
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

describe("InvoiceSchema", () => {
  it("accepts a well-formed invoice", () => {
    expect(InvoiceSchema.parse(validInvoice)).toEqual(validInvoice);
  });

  it("accepts an optional withholding amount", () => {
    const result = InvoiceSchema.safeParse({
      ...validInvoice,
      withholdingCents: 900,
    });
    expect(result.success).toBe(true);
  });

  it("rejects money that is not integer cents", () => {
    const result = InvoiceSchema.safeParse({
      ...validInvoice,
      totalCents: 66.5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects a supplier without a name", () => {
    const result = InvoiceSchema.safeParse({
      ...validInvoice,
      supplier: { name: "" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects dates that are not ISO YYYY-MM-DD", () => {
    const result = InvoiceSchema.safeParse({
      ...validInvoice,
      issueDate: "24/09/2026",
    });
    expect(result.success).toBe(false);
  });

  it("rejects currencies other than EUR", () => {
    const result = InvoiceSchema.safeParse({
      ...validInvoice,
      currency: "USD",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a VAT rate outside 0–100 %", () => {
    const line = { ...validInvoice.lines[0], vatRateBps: 12000 };
    const result = InvoiceSchema.safeParse({ ...validInvoice, lines: [line] });
    expect(result.success).toBe(false);
  });

  it("accepts fractional quantities (e.g. 1.5 kg)", () => {
    const line = { ...validInvoice.lines[0], quantity: 1.5 };
    const result = InvoiceSchema.safeParse({ ...validInvoice, lines: [line] });
    expect(result.success).toBe(true);
  });

  it("does NOT check business rules: sums that do not add up still parse", () => {
    const result = InvoiceSchema.safeParse({ ...validInvoice, totalCents: 1 });
    expect(result.success).toBe(true);
  });
});
