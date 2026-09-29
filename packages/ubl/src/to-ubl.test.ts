import type { Invoice } from "@invariant/schema";
import { describe, expect, it } from "vitest";
import { twoRates, withIrpf } from "./test-fixtures.js";
import { formatCents, toUbl } from "./to-ubl.js";

function xmlOf(invoice: Invoice): string {
  const result = toUbl(invoice);
  if (result.kind !== "ubl")
    throw new Error(`refused: ${result.reasons.join("; ")}`);
  return result.xml;
}

/** Text of every element with this qualified name, in document order. */
function texts(xml: string, name: string): string[] {
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([^<]*)</${name}>`, "g");
  return [...xml.matchAll(re)].map((m) => m[1] as string);
}

/** Inner XML of every element with this qualified name, in document order. */
function blocks(xml: string, name: string): string[] {
  const re = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "g");
  return [...xml.matchAll(re)].map((m) => m[1] as string);
}

/** Every start tag's qualified name, in document order. */
function elementOrder(xml: string): string[] {
  return [...xml.matchAll(/<([A-Za-z][\w:]*)/g)].map((m) => m[1] as string);
}

describe("formatCents", () => {
  it.each([
    [123456, "1234.56"],
    [0, "0.00"],
    [5, "0.05"],
    [100, "1.00"],
    [-5, "-0.05"],
    [-123456, "-1234.56"],
  ])("writes %i cents as %s", (cents, text) => {
    expect(formatCents(cents)).toBe(text);
  });

  it("rejects amounts that are not whole cents", () => {
    expect(() => formatCents(1.5)).toThrow(/integer cents/);
  });
});

describe("toUbl", () => {
  it("declares EN16931, type code 380 and EUR", () => {
    const xml = xmlOf(twoRates);
    expect(xml).toContain(
      'xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"',
    );
    expect(texts(xml, "cbc:CustomizationID")).toEqual([
      "urn:cen.eu:en16931:2017",
    ]);
    expect(texts(xml, "cbc:ID")[0]).toBe("F-2026-0042");
    expect(texts(xml, "cbc:IssueDate")).toEqual(["2026-09-24"]);
    expect(texts(xml, "cbc:InvoiceTypeCode")).toEqual(["380"]);
    expect(texts(xml, "cbc:DocumentCurrencyCode")).toEqual(["EUR"]);
  });

  it("writes one line per canonical line with quantity, price, amount, name and category", () => {
    const lines = blocks(xmlOf(twoRates), "cac:InvoiceLine");
    expect(lines).toHaveLength(3);
    const [first, second] = lines as [string, string];
    expect(first).toContain('<cbc:InvoicedQuantity unitCode="C62">2<');
    expect(first).toContain(
      '<cbc:LineExtensionAmount currencyID="EUR">100.00<',
    );
    expect(first).toContain("<cbc:Name>Aceite 5 L</cbc:Name>");
    expect(first).toContain('<cbc:PriceAmount currencyID="EUR">50.00<');
    expect(texts(first, "cbc:ID")).toEqual(["1", "S", "VAT"]);
    expect(texts(first, "cbc:Percent")).toEqual(["21"]);
    expect(second).toContain('<cbc:InvoicedQuantity unitCode="C62">1.5<');
    expect(second).toContain('<cbc:PriceAmount currencyID="EUR">22.22<');
    expect(texts(second, "cbc:Percent")).toEqual(["10"]);
  });

  it("writes one VAT breakdown per rate, with the sum of its lines as taxable amount", () => {
    const xml = xmlOf(twoRates);
    const taxTotal = blocks(xml, "cac:TaxTotal");
    expect(taxTotal).toHaveLength(1);
    expect(texts(taxTotal[0] as string, "cbc:TaxAmount")[0]).toBe("29.58");
    const subtotals = blocks(xml, "cac:TaxSubtotal");
    expect(
      subtotals.map((s) => [
        texts(s, "cbc:TaxableAmount")[0],
        texts(s, "cbc:TaxAmount")[0],
        texts(s, "cbc:ID")[0],
        texts(s, "cbc:Percent")[0],
      ]),
    ).toEqual([
      ["125.00", "26.25", "S", "21"],
      ["33.33", "3.33", "S", "10"],
    ]);
  });

  it("copies the printed totals", () => {
    const xml = xmlOf(twoRates);
    expect(texts(xml, "cbc:LineExtensionAmount").at(0)).toBe("158.33");
    expect(texts(xml, "cbc:TaxExclusiveAmount")).toEqual(["158.33"]);
    expect(texts(xml, "cbc:TaxInclusiveAmount")).toEqual(["187.91"]);
    expect(texts(xml, "cbc:PayableAmount")).toEqual(["187.91"]);
  });

  it("gives both parties country ES and the VAT id ES + tax id", () => {
    const xml = xmlOf(twoRates);
    expect(texts(xml, "cbc:IdentificationCode")).toEqual(["ES", "ES"]);
    const [seller, buyer] = [
      blocks(xml, "cac:AccountingSupplierParty")[0] as string,
      blocks(xml, "cac:AccountingCustomerParty")[0] as string,
    ];
    expect(texts(seller, "cbc:CompanyID")).toEqual([
      "ESB12345674",
      "B12345674",
    ]);
    expect(texts(seller, "cbc:RegistrationName")).toEqual([
      "Aceites García &amp; Hijos SL",
    ]);
    expect(texts(buyer, "cbc:CompanyID")).toEqual(["ES12345678Z", "12345678Z"]);
    expect(texts(buyer, "cbc:RegistrationName")).toEqual(["Taberna El Puerto"]);
  });

  it("normalizes tax ids before deriving the VAT id", () => {
    const xml = xmlOf({
      ...twoRates,
      supplier: { ...twoRates.supplier, taxId: "es b-12.345.674" },
    });
    expect(texts(xml, "cbc:CompanyID").slice(0, 2)).toEqual([
      "ESB12345674",
      "B12345674",
    ]);
  });

  it("maps a 0 % rate to category Z", () => {
    const xml = xmlOf({
      ...twoRates,
      lines: [
        {
          description: "Libro",
          quantity: 1,
          unitPriceCents: 1000,
          lineTotalCents: 1000,
          vatRateBps: 0,
        },
      ],
      taxBaseCents: 1000,
      vatAmountCents: 0,
      totalCents: 1000,
    });
    const [subtotal] = blocks(xml, "cac:TaxSubtotal") as [string];
    expect(texts(subtotal, "cbc:ID")).toEqual(["Z", "VAT"]);
    expect(texts(subtotal, "cbc:Percent")).toEqual(["0"]);
    expect(texts(subtotal, "cbc:TaxAmount")).toEqual(["0.00"]);
    const [line] = blocks(xml, "cac:InvoiceLine") as [string];
    expect(texts(line, "cbc:ID")).toEqual(["1", "Z", "VAT"]);
  });

  it("absorbs a one-cent VAT difference in the breakdown with the largest taxable amount", () => {
    const xml = xmlOf({ ...twoRates, vatAmountCents: 2959, totalCents: 18792 });
    expect(texts(xml, "cbc:TaxAmount")).toEqual(["29.59", "26.26", "3.33"]);
    expect(texts(xml, "cbc:PayableAmount")).toEqual(["187.92"]);
  });

  it("writes IRPF as a withholding tax total and keeps the payable amount gross", () => {
    const xml = xmlOf(withIrpf);
    expect(texts(xml, "cbc:PayableAmount")).toEqual(["2132.47"]);
    expect(texts(xml, "cbc:TaxInclusiveAmount")).toEqual(["2132.47"]);
    const [withholding] = blocks(xml, "cac:WithholdingTaxTotal") as [string];
    expect(texts(withholding, "cbc:TaxAmount")[0]).toBe("264.36");
    expect(texts(withholding, "cbc:ID")).toContain("IRPF");
    expect(blocks(xml, "cac:TaxTotal")).toHaveLength(1);
    expect(
      texts(blocks(xml, "cac:TaxTotal")[0] as string, "cbc:TaxAmount")[0],
    ).toBe("370.10");
  });

  it("leaves out the withholding tax total when there is no withholding", () => {
    expect(xmlOf(twoRates)).not.toContain("WithholdingTaxTotal");
  });

  it("refuses an invoice without a buyer tax id", () => {
    const { taxId: _, ...customer } = twoRates.customer;
    expect(toUbl({ ...twoRates, customer })).toEqual({
      kind: "refused",
      reasons: ["The buyer tax id is required for a B2B e-invoice."],
    });
  });

  it("refuses an invoice with an invalid seller tax id, naming the seller", () => {
    const result = toUbl({
      ...twoRates,
      supplier: { ...twoRates.supplier, taxId: "B12345670" },
    });
    expect(result.kind).toBe("refused");
    expect(result.kind === "refused" && result.reasons).toEqual([
      "The seller tax id B12345670 is not a valid Spanish tax id: CIF control should be 4.",
    ]);
  });

  it("refuses a foreign buyer VAT number, which carries no Spanish country", () => {
    const result = toUbl({
      ...twoRates,
      customer: { ...twoRates.customer, taxId: "FR12345678901" },
    });
    expect(result.kind === "refused" && result.reasons).toEqual([
      "The buyer tax id FR12345678901 is not a valid Spanish tax id: not a Spanish NIF, NIE or CIF.",
    ]);
  });

  it("lists every reason when both parties are unusable", () => {
    const result = toUbl({
      ...twoRates,
      supplier: { name: "Sin NIF" },
      customer: { name: "Particular" },
    });
    expect(result.kind === "refused" && result.reasons).toEqual([
      "The seller tax id is required for a B2B e-invoice.",
      "The buyer tax id is required for a B2B e-invoice.",
    ]);
  });

  it("writes elements in the UBL 2.1 schema order", () => {
    const xml = xmlOf(withIrpf);
    const party = (role: string) => [
      role,
      "cac:Party",
      "cac:PostalAddress",
      "cac:Country",
      "cbc:IdentificationCode",
      "cac:PartyTaxScheme",
      "cbc:CompanyID",
      "cac:TaxScheme",
      "cbc:ID",
      "cac:PartyLegalEntity",
      "cbc:RegistrationName",
      "cbc:CompanyID",
    ];
    const line = [
      "cac:InvoiceLine",
      "cbc:ID",
      "cbc:InvoicedQuantity",
      "cbc:LineExtensionAmount",
      "cac:Item",
      "cbc:Name",
      "cac:ClassifiedTaxCategory",
      "cbc:ID",
      "cbc:Percent",
      "cac:TaxScheme",
      "cbc:ID",
      "cac:Price",
      "cbc:PriceAmount",
    ];
    expect(elementOrder(xml)).toEqual([
      "Invoice",
      "cbc:CustomizationID",
      "cbc:ID",
      "cbc:IssueDate",
      "cbc:InvoiceTypeCode",
      "cbc:DocumentCurrencyCode",
      ...party("cac:AccountingSupplierParty"),
      ...party("cac:AccountingCustomerParty"),
      "cac:TaxTotal",
      "cbc:TaxAmount",
      "cac:TaxSubtotal",
      "cbc:TaxableAmount",
      "cbc:TaxAmount",
      "cac:TaxCategory",
      "cbc:ID",
      "cbc:Percent",
      "cac:TaxScheme",
      "cbc:ID",
      "cac:WithholdingTaxTotal",
      "cbc:TaxAmount",
      "cac:TaxSubtotal",
      "cbc:TaxAmount",
      "cac:TaxCategory",
      "cac:TaxScheme",
      "cbc:ID",
      "cac:LegalMonetaryTotal",
      "cbc:LineExtensionAmount",
      "cbc:TaxExclusiveAmount",
      "cbc:TaxInclusiveAmount",
      "cbc:PayableAmount",
      ...line,
      ...line,
    ]);
  });
});
