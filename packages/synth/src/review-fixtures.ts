import { validateSpanishTaxId } from "@invariant/rules";
import type { Invoice } from "@invariant/schema";
import { generateInvoice } from "./generate.js";
import { createRandom, type Random } from "./random.js";
import {
  formatDate,
  formatMoney,
  formatQuantity,
  formatRate,
  vatBreakdown,
} from "./templates/format.js";
import type { SyntheticInvoice } from "./types.js";

/**
 * The printed errors a review fixture can carry, one per document. Each is
 * caught by a business rule once the text is read faithfully:
 * `total`, `vat-amount`, `tax-ids`, and `line-amount` plus `lines-sum`.
 */
export const ERROR_KINDS = [
  "wrong-total",
  "wrong-vat",
  "invalid-tax-id",
  "line-amount",
] as const;
export type ErrorKind = (typeof ERROR_KINDS)[number];

/** What was changed on the printed document: where, the true value and the printed one. */
export interface InjectedError {
  kind: ErrorKind;
  /** The invoice field, e.g. "totalCents" or "lines[1].lineTotalCents". */
  path: string;
  /** The true value (cents, or the tax id). */
  expected: number | string;
  /** The value printed instead. */
  printed: number | string;
}

/** One manifest line: the file, the true invoice and the error printed on it. */
export interface ReviewFixtureManifest {
  file: string;
  seed: number;
  error: InjectedError;
  invoice: Invoice;
}

export interface ReviewFixture {
  file: string;
  text: string;
  manifest: ReviewFixtureManifest;
}

const TOTALS_WIDTH = 63;
const DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";

/** `label` and `value`, with the value right-aligned at the totals column. */
function totalsRow(label: string, value: string): string {
  const gap = Math.max(2, TOTALS_WIDTH - label.length - value.length);
  return `${label}${" ".repeat(gap)}${value}`;
}

function lineRow(
  description: string,
  quantity: string,
  price: string,
  amount: string,
): string {
  const first =
    description.length >= 36 ? `${description}  ` : description.padEnd(36);
  return `${first}${quantity.padStart(4)}${price.padStart(11)}${amount.padStart(12)}`;
}

/** "CIF" for companies (a letter first), "NIF" for people. */
function taxIdLabel(taxId: string): string {
  return /^[A-Z]/.test(taxId) && !/^[XYZ]/.test(taxId) ? "CIF" : "NIF";
}

/**
 * Renders an invoice as plain text, in the layout of `fixtures/text`: supplier
 * and tax id, number and date, customer, one row per line, base and VAT per
 * rate, withholding and total.
 *
 * It prints the invoice's own `taxBaseCents` and `vatAmountCents`: the rows
 * per rate come from the lines, and any difference goes to the first row. So a
 * printed error in a line or in the VAT stays visible against the lines.
 */
export function renderInvoiceText(
  invoice: Invoice,
  meta: Pick<SyntheticInvoice["meta"], "supplierAddress" | "customerAddress">,
): string {
  const rates = vatBreakdown(invoice);
  const first = rates[0];
  if (first) {
    first.base +=
      invoice.taxBaseCents - rates.reduce((sum, r) => sum + r.base, 0);
    first.vat +=
      invoice.vatAmountCents - rates.reduce((sum, r) => sum + r.vat, 0);
  }
  const supplierId = invoice.supplier.taxId ?? "";
  const customerId = invoice.customer.taxId;
  const header = invoice.supplier.name.toUpperCase();
  const lines = [
    `${header.padEnd(Math.max(header.length + 2, 35))}${taxIdLabel(supplierId)}: ${supplierId}`,
    meta.supplierAddress,
    "",
    totalsRow(
      `FACTURA Nº ${invoice.number}`,
      `Fecha: ${formatDate(invoice.issueDate)}`,
    ),
    "",
    `Cliente: ${invoice.customer.name}${customerId ? ` · ${taxIdLabel(customerId)} ${customerId}` : ""}`,
    meta.customerAddress,
    "",
    lineRow("Descripción", "Cant.", "Precio", "Importe"),
    ...invoice.lines.map((line) =>
      lineRow(
        line.description,
        formatQuantity(line.quantity),
        formatMoney(line.unitPriceCents),
        formatMoney(line.lineTotalCents),
      ),
    ),
    "",
    ...rates.map((r) =>
      totalsRow(
        `Base imponible IVA ${formatRate(r.rate)}`,
        formatMoney(r.base),
      ),
    ),
    ...rates.map((r) =>
      totalsRow(`Cuota IVA ${formatRate(r.rate)}`, formatMoney(r.vat)),
    ),
    ...(invoice.withholdingCents === undefined
      ? []
      : [
          totalsRow(
            "Retención IRPF 15 %",
            `-${formatMoney(invoice.withholdingCents)}`,
          ),
        ]),
    totalsRow("TOTAL FACTURA", formatMoney(invoice.totalCents)),
  ];
  return `${lines.join("\n")}\n`;
}

/** A realistic slip: a digit off, or ten euros more or less. Never zero or below. */
function slip(random: Random, cents: number): number {
  const deltas = [1000, -1000, 100, -100, 900, 9000];
  const delta = random.pick(deltas);
  return cents + delta > 0 ? cents + delta : cents + 1000;
}

/** The tax id with its last character changed so its check fails. */
function breakTaxId(taxId: string): string {
  for (let step = 1; step < DNI_LETTERS.length; step++) {
    const last = taxId.at(-1) ?? "";
    const next = /\d/.test(last)
      ? String((Number(last) + step) % 10)
      : (DNI_LETTERS[(DNI_LETTERS.indexOf(last) + step) % DNI_LETTERS.length] ??
        "A");
    const broken = `${taxId.slice(0, -1)}${next}`;
    if (!validateSpanishTaxId(broken).valid) return broken;
  }
  throw new Error(`could not break tax id ${taxId}`);
}

/**
 * Changes one printed value of a correct invoice, the way a real invoice gets
 * it wrong. Returns the invoice as printed and what was changed. Only that
 * value changes: a wrong VAT keeps the total, so the printed document itself
 * is inconsistent, which is what a reviewer has to catch.
 */
export function injectError(
  invoice: Invoice,
  kind: ErrorKind,
  random: Random,
): { printed: Invoice; error: InjectedError } {
  switch (kind) {
    case "wrong-total": {
      const printed = slip(random, invoice.totalCents);
      return {
        printed: { ...invoice, totalCents: printed },
        error: {
          kind,
          path: "totalCents",
          expected: invoice.totalCents,
          printed,
        },
      };
    }
    case "wrong-vat": {
      const printed = slip(random, invoice.vatAmountCents);
      return {
        printed: { ...invoice, vatAmountCents: printed },
        error: {
          kind,
          path: "vatAmountCents",
          expected: invoice.vatAmountCents,
          printed,
        },
      };
    }
    case "invalid-tax-id": {
      const expected = invoice.supplier.taxId;
      if (expected === undefined) throw new Error("supplier has no tax id");
      const printed = breakTaxId(expected);
      return {
        printed: {
          ...invoice,
          supplier: { ...invoice.supplier, taxId: printed },
        },
        error: { kind, path: "supplier.taxId", expected, printed },
      };
    }
    case "line-amount": {
      const index = random.int(0, invoice.lines.length - 1);
      const line = invoice.lines[index];
      if (!line) throw new Error("invoice has no lines");
      const printed = slip(random, line.lineTotalCents);
      return {
        printed: {
          ...invoice,
          lines: invoice.lines.map((l, i) =>
            i === index ? { ...l, lineTotalCents: printed } : l,
          ),
        },
        error: {
          kind,
          path: `lines[${index}].lineTotalCents`,
          expected: line.lineTotalCents,
          printed,
        },
      };
    }
  }
}

/**
 * Text invoices for the review queue, each with one printed error. Invoice
 * `i` uses seed `seed + i` and the error kinds rotate, so every kind appears.
 * The same seed and count always give the same files. File names do not give
 * the error away; the manifest holds it with the true invoice.
 */
export function generateReviewFixtures(options: {
  count: number;
  seed: number;
}): ReviewFixture[] {
  return Array.from({ length: options.count }, (_, i) => {
    const seed = options.seed + i;
    const synthetic = generateInvoice(seed);
    const kind = ERROR_KINDS[i % ERROR_KINDS.length] as ErrorKind;
    // Its own stream, so the invoice stays the same if the injection changes.
    const { printed, error } = injectError(
      synthetic.invoice,
      kind,
      createRandom(seed * 104_729 + 7),
    );
    const file = `review-${String(seed).padStart(6, "0")}.txt`;
    return {
      file,
      text: renderInvoiceText(printed, synthetic.meta),
      manifest: { file, seed, error, invoice: synthetic.invoice },
    };
  });
}
