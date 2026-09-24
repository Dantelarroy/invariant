import type { Invoice } from "@invariant/schema";
import { RULES, type Rule, type RuleContext, type Violation } from "./rules.js";

export type VerificationResult = {
  /** True when no rule with severity "error" failed. Warnings are reported but do not block. */
  valid: boolean;
  /** Share of rules that held, from 0 to 1. Used for label-free evals and as an RL reward. */
  score: number;
  violations: Violation[];
};

/**
 * Runs every business rule against an invoice. Pure: no I/O, no model calls,
 * and no hidden clock — pass `today` for reproducible results (defaults to the current date).
 */
export function verifyInvoice(
  invoice: Invoice,
  options: { today?: string; rules?: readonly Rule[] } = {},
): VerificationResult {
  const rules = options.rules ?? RULES;
  const context: RuleContext = {
    today: options.today ?? new Date().toISOString().slice(0, 10),
  };
  const violations: Violation[] = [];
  let passed = 0;

  for (const rule of rules) {
    const found = rule.check(invoice, context);
    if (found.length === 0) passed += 1;
    for (const f of found) {
      violations.push({ ruleId: rule.id, severity: rule.severity, ...f });
    }
  }

  return {
    valid: violations.every((v) => v.severity !== "error"),
    score: rules.length === 0 ? 1 : passed / rules.length,
    violations,
  };
}
