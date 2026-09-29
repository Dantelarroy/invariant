import { applyRate, validateSpanishTaxId } from "@invariant/rules";
import type { Invoice, Party } from "@invariant/schema";
import { create } from "xmlbuilder2";
import type { XMLBuilder } from "xmlbuilder2/lib/interfaces.js";

export type UblResult =
  | { kind: "ubl"; xml: string }
  | { kind: "refused"; reasons: string[] };

const INVOICE_NS = "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2";
const CAC_NS =
  "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2";
const CBC_NS =
  "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2";
const EN16931 = "urn:cen.eu:en16931:2017";
/** Commercial invoice (UNTDID 1001). */
const INVOICE_TYPE_CODE = "380";
/** "One" (UN/ECE Rec. 20): an explicit "unspecified" unit (ADR-0009). */
const UNIT_CODE = "C62";

/**
 * Writes integer cents as a decimal amount with two decimals ("1234.56"),
 * using integer division only.
 */
export function formatCents(cents: number): string {
  if (!Number.isSafeInteger(cents))
    throw new Error(`Amounts must be integer cents, got ${cents}.`);
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const units = Math.trunc(abs / 100);
  const rest = abs % 100;
  return `${sign}${units}.${String(rest).padStart(2, "0")}`;
}

/** Basis points as a percentage without trailing zeros: 2100 → "21", 1050 → "10.5". */
function formatPercent(bps: number): string {
  const units = Math.trunc(bps / 100);
  const rest = bps % 100;
  if (rest === 0) return String(units);
  return `${units}.${String(rest).padStart(2, "0").replace(/0$/, "")}`;
}

/** VAT category: standard rate above 0 %, zero rated at 0 % (ADR-0009). */
const vatCategory = (bps: number) => (bps > 0 ? "S" : "Z");

type PartyId = { vatId: string; legalId: string };

/** The party's normalized Spanish tax id, or the reason it cannot be used. */
function spanishTaxId(
  party: Party,
  role: "seller" | "buyer",
): PartyId | { reason: string } {
  if (party.taxId === undefined)
    return { reason: `The ${role} tax id is required for a B2B e-invoice.` };
  const check = validateSpanishTaxId(party.taxId);
  if (!check.valid || check.kind === "foreign") {
    const why = check.valid ? "not a Spanish NIF, NIE or CIF" : check.reason;
    return {
      reason: `The ${role} tax id ${party.taxId} is not a valid Spanish tax id: ${why}.`,
    };
  }
  return { vatId: `ES${check.normalized}`, legalId: check.normalized };
}

type Breakdown = { rateBps: number; taxableCents: number; taxCents: number };

/**
 * One VAT breakdown per rate, highest rate first. The taxable amount is the
 * sum of the lines at that rate and the tax is `applyRate` of it. A one-cent
 * difference with the printed VAT goes to the largest taxable amount, so the
 * breakdowns add up to the printed VAT (BR-CO-14, ADR-0009).
 */
function vatBreakdown(invoice: Invoice): Breakdown[] {
  const taxableByRate = new Map<number, number>();
  for (const line of invoice.lines)
    taxableByRate.set(
      line.vatRateBps,
      (taxableByRate.get(line.vatRateBps) ?? 0) + line.lineTotalCents,
    );
  const breakdown = [...taxableByRate]
    .sort(([a], [b]) => b - a)
    .map(([rateBps, taxableCents]) => ({
      rateBps,
      taxableCents,
      taxCents: applyRate(taxableCents, rateBps),
    }));

  const difference =
    invoice.vatAmountCents - breakdown.reduce((sum, b) => sum + b.taxCents, 0);
  const largest = breakdown
    .filter((b) => b.rateBps > 0)
    .reduce<Breakdown | undefined>(
      (max, b) =>
        max === undefined || b.taxableCents > max.taxableCents ? b : max,
      undefined,
    );
  if (Math.abs(difference) === 1 && largest) largest.taxCents += difference;
  return breakdown;
}

/**
 * Maps a canonical invoice to an EN16931 UBL 2.1 invoice, or refuses when the
 * data a B2B e-invoice needs is missing or invalid (ADR-0009).
 */
export function toUbl(invoice: Invoice): UblResult {
  const seller = spanishTaxId(invoice.supplier, "seller");
  const buyer = spanishTaxId(invoice.customer, "buyer");
  const reasons = [seller, buyer].flatMap((p) =>
    "reason" in p ? [p.reason] : [],
  );
  if ("reason" in seller || "reason" in buyer)
    return { kind: "refused", reasons };

  const amount = (parent: XMLBuilder, name: string, cents: number) =>
    parent
      .ele(CBC_NS, `cbc:${name}`, { currencyID: "EUR" })
      .txt(formatCents(cents))
      .up();
  const text = (parent: XMLBuilder, name: string, value: string) =>
    parent.ele(CBC_NS, `cbc:${name}`).txt(value).up();
  const vatCategoryElement = (
    parent: XMLBuilder,
    name: string,
    rateBps: number,
  ) => {
    const category = parent.ele(CAC_NS, `cac:${name}`);
    text(category, "ID", vatCategory(rateBps));
    text(category, "Percent", formatPercent(rateBps));
    text(category.ele(CAC_NS, "cac:TaxScheme"), "ID", "VAT");
  };
  const party = (role: string, from: Party, id: PartyId) => {
    const p = root.ele(CAC_NS, `cac:${role}`).ele(CAC_NS, "cac:Party");
    text(
      p.ele(CAC_NS, "cac:PostalAddress").ele(CAC_NS, "cac:Country"),
      "IdentificationCode",
      "ES",
    );
    const taxScheme = p.ele(CAC_NS, "cac:PartyTaxScheme");
    text(taxScheme, "CompanyID", id.vatId);
    text(taxScheme.ele(CAC_NS, "cac:TaxScheme"), "ID", "VAT");
    const legal = p.ele(CAC_NS, "cac:PartyLegalEntity");
    text(legal, "RegistrationName", from.name);
    text(legal, "CompanyID", id.legalId);
  };

  const doc = create({ version: "1.0", encoding: "UTF-8" });
  const root = doc
    .ele(INVOICE_NS, "Invoice")
    .att("http://www.w3.org/2000/xmlns/", "xmlns:cac", CAC_NS)
    .att("http://www.w3.org/2000/xmlns/", "xmlns:cbc", CBC_NS);

  text(root, "CustomizationID", EN16931);
  text(root, "ID", invoice.number);
  text(root, "IssueDate", invoice.issueDate);
  text(root, "InvoiceTypeCode", INVOICE_TYPE_CODE);
  text(root, "DocumentCurrencyCode", invoice.currency);
  party("AccountingSupplierParty", invoice.supplier, seller);
  party("AccountingCustomerParty", invoice.customer, buyer);

  const taxTotal = root.ele(CAC_NS, "cac:TaxTotal");
  amount(taxTotal, "TaxAmount", invoice.vatAmountCents);
  for (const b of vatBreakdown(invoice)) {
    const subtotal = taxTotal.ele(CAC_NS, "cac:TaxSubtotal");
    amount(subtotal, "TaxableAmount", b.taxableCents);
    amount(subtotal, "TaxAmount", b.taxCents);
    vatCategoryElement(subtotal, "TaxCategory", b.rateBps);
  }

  // IRPF is not part of EN16931 (UBL-CR-513 warns); the totals stay gross.
  if (invoice.withholdingCents) {
    const withholding = root.ele(CAC_NS, "cac:WithholdingTaxTotal");
    amount(withholding, "TaxAmount", invoice.withholdingCents);
    const subtotal = withholding.ele(CAC_NS, "cac:TaxSubtotal");
    amount(subtotal, "TaxAmount", invoice.withholdingCents);
    text(
      subtotal.ele(CAC_NS, "cac:TaxCategory").ele(CAC_NS, "cac:TaxScheme"),
      "ID",
      "IRPF",
    );
  }

  // Printed totals, copied as they are (ADR-0009): rounding shows up as BR-CO-10/13.
  const linesCents = invoice.lines.reduce((s, l) => s + l.lineTotalCents, 0);
  const inclusiveCents = invoice.taxBaseCents + invoice.vatAmountCents;
  const totals = root.ele(CAC_NS, "cac:LegalMonetaryTotal");
  amount(totals, "LineExtensionAmount", linesCents);
  amount(totals, "TaxExclusiveAmount", invoice.taxBaseCents);
  amount(totals, "TaxInclusiveAmount", inclusiveCents);
  amount(totals, "PayableAmount", inclusiveCents);

  invoice.lines.forEach((line, i) => {
    const l = root.ele(CAC_NS, "cac:InvoiceLine");
    text(l, "ID", String(i + 1));
    l.ele(CBC_NS, "cbc:InvoicedQuantity", { unitCode: UNIT_CODE })
      .txt(String(line.quantity))
      .up();
    amount(l, "LineExtensionAmount", line.lineTotalCents);
    const item = l.ele(CAC_NS, "cac:Item");
    text(item, "Name", line.description);
    vatCategoryElement(item, "ClassifiedTaxCategory", line.vatRateBps);
    amount(l.ele(CAC_NS, "cac:Price"), "PriceAmount", line.unitPriceCents);
  });

  return { kind: "ubl", xml: doc.end({ prettyPrint: true }) };
}
