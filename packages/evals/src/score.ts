import { verifyInvoice } from "@invariant/rules";
import type { Invoice } from "@invariant/schema";

/** The fields compared with the label (ADR-0008). Lines are scored by count only, for now. */
export const SCORED_FIELDS = [
  "number",
  "issueDate",
  "supplierTaxId",
  "customerTaxId",
  "taxBaseCents",
  "vatAmountCents",
  "withholdingCents",
  "totalCents",
  "lineCount",
] as const;

export type ScoredField = (typeof SCORED_FIELDS)[number];

type FieldValue = string | number | undefined;

export type FieldResult = {
  expected: FieldValue;
  actual: FieldValue;
  match: boolean;
};

/** Whether the extraction passes the business rules, independently of the label. */
export type RuleVerdict = {
  valid: boolean;
  /** Ids of every rule with a violation, warnings included. */
  failedRuleIds: string[];
};

/** What an unlabeled document is scored on: the business rules only. */
export type RuleScore = {
  rules: RuleVerdict;
};

export type ExtractionScore = {
  fields: Record<ScoredField, FieldResult>;
  /** True when every scored field matches. */
  exactMatch: boolean;
  rules: RuleVerdict;
};

/** Removes case, spaces, dots and hyphens, so "b-12.345.674" equals "B12345674". */
const normalizeId = (id: string) => id.replace(/[\s.-]/g, "").toUpperCase();

const IDENTIFIERS: ReadonlySet<ScoredField> = new Set([
  "number",
  "supplierTaxId",
  "customerTaxId",
]);

function fieldValues(invoice: Invoice): Record<ScoredField, FieldValue> {
  return {
    number: invoice.number,
    issueDate: invoice.issueDate,
    supplierTaxId: invoice.supplier.taxId,
    customerTaxId: invoice.customer.taxId,
    taxBaseCents: invoice.taxBaseCents,
    vatAmountCents: invoice.vatAmountCents,
    withholdingCents: invoice.withholdingCents,
    totalCents: invoice.totalCents,
    lineCount: invoice.lines.length,
  };
}

/**
 * Amounts match exactly in cents and dates as ISO strings; identifiers match
 * after normalization. A value absent on both sides is a match.
 */
function matches(
  field: ScoredField,
  expected: FieldValue,
  actual: FieldValue,
): boolean {
  if (
    IDENTIFIERS.has(field) &&
    typeof expected === "string" &&
    typeof actual === "string"
  )
    return normalizeId(expected) === normalizeId(actual);
  return expected === actual;
}

/**
 * Compares an extracted invoice with its label, field by field, and reports
 * whether the extraction passes the business rules. `actual` is null when the
 * extraction failed: every field is then a mismatch and the verdict is invalid.
 * Pure: pass `today` (fixed per run) so scores are reproducible.
 */
export function scoreExtraction(
  expected: Invoice,
  actual: Invoice | null,
  options: { today: string },
): ExtractionScore {
  const expectedValues = fieldValues(expected);
  const actualValues = actual === null ? null : fieldValues(actual);

  const fields = Object.fromEntries(
    SCORED_FIELDS.map((field) => {
      const value = actualValues?.[field];
      const match =
        actualValues !== null && matches(field, expectedValues[field], value);
      return [field, { expected: expectedValues[field], actual: value, match }];
    }),
  ) as Record<ScoredField, FieldResult>;

  return {
    fields,
    exactMatch: SCORED_FIELDS.every((field) => fields[field].match),
    rules: ruleVerdict(actual, options.today),
  };
}

/**
 * Scores an extraction without a label: only whether it passes the business
 * rules. `actual` is null when the extraction failed (an invalid verdict).
 */
export function scoreRules(
  actual: Invoice | null,
  options: { today: string },
): RuleScore {
  return { rules: ruleVerdict(actual, options.today) };
}

function ruleVerdict(actual: Invoice | null, today: string): RuleVerdict {
  if (actual === null) return { valid: false, failedRuleIds: [] };
  const { valid, violations } = verifyInvoice(actual, { today });
  return {
    valid,
    failedRuleIds: [...new Set(violations.map((v) => v.ruleId))],
  };
}
