import { formatMoney, type Invoice } from "@invariant/schema";
import { applyRate } from "./rounding.js";

export type Severity = "error" | "warning";

export type Violation = {
  ruleId: string;
  severity: Severity;
  message: string;
  /** Where the problem is, e.g. "lines[1].lineTotalCents". */
  path?: string;
};

export type Rule = {
  id: string;
  severity: Severity;
  /** Returns one entry per problem found; an empty array means the rule holds. */
  check: (invoice: Invoice) => { message: string; path?: string }[];
};

/** Rounding differences smaller than this are not errors. */
const TOLERANCE_CENTS = 1;

/** VAT rates in force in Spain (basis points). 5 % was temporary, until 2024. */
const VAT_RATES = new Set([0, 400, 1000, 2100]);
const TEMPORARY_5_PERCENT_UNTIL = "2024-12-31";

const percent = (bps: number) => `${bps / 100} %`;

export const lineAmount: Rule = {
  id: "line-amount",
  // A warning: line discounts are not modelled yet, so a mismatch may be legitimate.
  severity: "warning",
  check: (invoice) =>
    invoice.lines.flatMap((line, i) => {
      const expected = line.quantity * line.unitPriceCents;
      if (Math.abs(line.lineTotalCents - expected) <= TOLERANCE_CENTS)
        return [];
      return [
        {
          message: `Line ${i + 1}: ${line.quantity} × ${formatMoney(line.unitPriceCents)} is ${formatMoney(Math.round(expected))}, but the line says ${formatMoney(line.lineTotalCents)}.`,
          path: `lines[${i}].lineTotalCents`,
        },
      ];
    }),
};

export const linesSum: Rule = {
  id: "lines-sum",
  severity: "error",
  check: (invoice) => {
    const sum = invoice.lines.reduce((acc, l) => acc + l.lineTotalCents, 0);
    if (sum === invoice.taxBaseCents) return [];
    return [
      {
        message: `Lines add up to ${formatMoney(sum)} but the tax base is ${formatMoney(invoice.taxBaseCents)}.`,
        path: "taxBaseCents",
      },
    ];
  },
};

export const vatRate: Rule = {
  id: "vat-rate",
  severity: "error",
  check: (invoice) =>
    invoice.lines.flatMap((line, i) => {
      const allowed =
        VAT_RATES.has(line.vatRateBps) ||
        (line.vatRateBps === 500 &&
          invoice.issueDate <= TEMPORARY_5_PERCENT_UNTIL);
      if (allowed) return [];
      return [
        {
          message: `Line ${i + 1}: ${percent(line.vatRateBps)} is not a Spanish VAT rate on ${invoice.issueDate}.`,
          path: `lines[${i}].vatRateBps`,
        },
      ];
    }),
};

export const vatAmount: Rule = {
  id: "vat-amount",
  severity: "error",
  check: (invoice) => {
    // Spanish invoices print one VAT amount per rate, computed on that rate's base.
    const baseByRate = new Map<number, number>();
    for (const line of invoice.lines) {
      baseByRate.set(
        line.vatRateBps,
        (baseByRate.get(line.vatRateBps) ?? 0) + line.lineTotalCents,
      );
    }
    let expected = 0;
    for (const [rate, base] of baseByRate) expected += applyRate(base, rate);

    if (Math.abs(expected - invoice.vatAmountCents) <= TOLERANCE_CENTS)
      return [];
    return [
      {
        message: `VAT should be ${formatMoney(expected)} (base × rate, per rate) but the invoice says ${formatMoney(invoice.vatAmountCents)}.`,
        path: "vatAmountCents",
      },
    ];
  },
};

export const total: Rule = {
  id: "total",
  severity: "error",
  check: (invoice) => {
    const expected =
      invoice.taxBaseCents +
      invoice.vatAmountCents -
      (invoice.withholdingCents ?? 0);
    if (expected === invoice.totalCents) return [];
    return [
      {
        message: `Total is ${formatMoney(invoice.totalCents)} but base + VAT − withholding is ${formatMoney(expected)}.`,
        path: "totalCents",
      },
    ];
  },
};

export const RULES: readonly Rule[] = [
  lineAmount,
  linesSum,
  vatRate,
  vatAmount,
  total,
];
