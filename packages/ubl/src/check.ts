import type { Invoice } from "@invariant/schema";
import { toUbl } from "./to-ubl.js";
import type { ValidationResult } from "./validate.js";

export type DocumentCheck = {
  id: string;
  status: "valid" | "refused" | "invalid";
  reasons: string[];
  result?: ValidationResult;
};

/** How many documents hit one rule or refusal, with a few document ids as examples. */
export type Tally<K extends string> = { count: number; examples: string[] } & {
  [key in K]: string;
};

export type CheckReport = {
  documents: number;
  valid: number;
  refused: number;
  invalid: number;
  refusals: Tally<"reason">[];
  errors: Tally<"ruleId">[];
  warnings: Tally<"ruleId">[];
};

const MAX_EXAMPLES = 3;

/** Counts documents per key (once per document), most frequent first. */
function tally<K extends string>(
  field: K,
  entries: { id: string; keys: string[] }[],
): Tally<K>[] {
  const byKey = new Map<string, string[]>();
  for (const { id, keys } of entries)
    for (const key of new Set(keys))
      byKey.set(key, [...(byKey.get(key) ?? []), id]);
  return [...byKey]
    .sort(([a, x], [b, y]) => y.length - x.length || a.localeCompare(b))
    .map(
      ([key, ids]) =>
        ({
          [field]: key,
          count: ids.length,
          examples: ids.slice(0, MAX_EXAMPLES),
        }) as Tally<K>,
    );
}

/**
 * Exports and validates labeled invoices one at a time. Only validation
 * errors make a document invalid; warnings are counted apart.
 */
export async function checkDocuments(
  items: { id: string; invoice: Invoice }[],
  validate: (xml: string) => Promise<ValidationResult>,
  options: { onResult?: (check: DocumentCheck) => void } = {},
): Promise<CheckReport> {
  const checks: DocumentCheck[] = [];
  for (const { id, invoice } of items) {
    const ubl = toUbl(invoice);
    let check: DocumentCheck;
    if (ubl.kind === "refused") {
      check = { id, status: "refused", reasons: ubl.reasons };
    } else {
      const result = await validate(ubl.xml);
      check = {
        id,
        status: result.valid ? "valid" : "invalid",
        reasons: [],
        result,
      };
    }
    checks.push(check);
    options.onResult?.(check);
  }

  const count = (status: DocumentCheck["status"]) =>
    checks.filter((c) => c.status === status).length;
  const rules = (pick: (r: ValidationResult) => { ruleId: string }[]) =>
    checks.map((c) => ({
      id: c.id,
      keys: c.result ? pick(c.result).map((f) => f.ruleId) : [],
    }));
  return {
    documents: checks.length,
    valid: count("valid"),
    refused: count("refused"),
    invalid: count("invalid"),
    refusals: tally(
      "reason",
      checks.map((c) => ({ id: c.id, keys: c.reasons })),
    ),
    errors: tally(
      "ruleId",
      rules((r) => r.errors),
    ),
    warnings: tally(
      "ruleId",
      rules((r) => r.warnings),
    ),
  };
}
