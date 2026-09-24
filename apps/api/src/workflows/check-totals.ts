import { formatMoney, type Invoice } from "@invariant/schema";

export type Issue = { code: string; message: string };

/**
 * Minimal arithmetic checks so the workflow can already route to human review.
 * Placeholder: the full rule set (VAT per rate, tax IDs, dates, EN16931)
 * lives in @invariant/rules from day 7 and replaces this function.
 */
export function checkTotals(invoice: Invoice): Issue[] {
  const issues: Issue[] = [];

  const linesSum = invoice.lines.reduce((sum, l) => sum + l.lineTotalCents, 0);
  if (linesSum !== invoice.taxBaseCents) {
    issues.push({
      code: "LINES_SUM_MISMATCH",
      message: `Lines add up to ${formatMoney(linesSum)} but the tax base is ${formatMoney(invoice.taxBaseCents)}.`,
    });
  }

  const expectedTotal =
    invoice.taxBaseCents +
    invoice.vatAmountCents -
    (invoice.withholdingCents ?? 0);
  if (expectedTotal !== invoice.totalCents) {
    issues.push({
      code: "TOTAL_MISMATCH",
      message: `Total is ${formatMoney(invoice.totalCents)} but base + VAT − withholding is ${formatMoney(expectedTotal)}.`,
    });
  }

  return issues;
}
