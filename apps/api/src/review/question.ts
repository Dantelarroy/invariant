import { RULES, type ViolationDetails } from "@invariant/rules";
import { formatMoney } from "@invariant/schema";

/** A rule violation as the workflow carries it (see IssueSchema). */
export interface ReviewIssue {
  ruleId: string;
  severity: "error" | "warning";
  message: string;
  path?: string | undefined;
  details?: ViolationDetails | undefined;
}

/** Used when the first error carries no details we know how to phrase. */
const GENERAL_QUESTION =
  "Algunas reglas de negocio fallan. ¿La extracción es fiel al documento?";

const PARTY: Record<string, string> = {
  supplier: "proveedor",
  customer: "cliente",
};

const RULE_ORDER = new Map(RULES.map((rule, index) => [rule.id, index]));

/**
 * Builds the reviewer's question from the first error (in rule order) and the
 * `line-amount` warnings (ADR-0010). The question is in Spanish, the
 * reviewer's language; amounts use `formatMoney` ("1.234,56 €"). It states the
 * conflicting values and asks about the one printed on the document.
 */
export function buildReviewQuestion(issues: readonly ReviewIssue[]): string {
  const first = issues
    .filter((issue) => issue.severity === "error")
    .sort(
      (a, b) =>
        (RULE_ORDER.get(a.ruleId) ?? RULES.length) -
        (RULE_ORDER.get(b.ruleId) ?? RULES.length),
    )[0];
  const question = (first && questionFor(first)) ?? GENERAL_QUESTION;
  const context = issues
    .filter((issue) => issue.severity === "warning")
    .map(lineAmountContext)
    .filter((sentence) => sentence !== undefined);
  return [question, ...context].join(" ");
}

function questionFor(issue: ReviewIssue): string | undefined {
  const d = issue.details;
  if (!d) return undefined;
  switch (issue.ruleId) {
    case "lines-sum": {
      const sum = cents(d.linesSumCents);
      const base = cents(d.taxBaseCents);
      if (sum === undefined || base === undefined) return undefined;
      return `Las líneas suman ${formatMoney(sum)} pero la base imponible impresa es ${formatMoney(base)}. ¿La base imponible del documento es ${formatMoney(base)}?`;
    }
    case "vat-rate": {
      const line = d.line;
      const rate = cents(d.rateBps);
      if (typeof line !== "number" || rate === undefined) return undefined;
      return `La línea ${line} tiene un IVA del ${percent(rate)}, que no es un tipo vigente en España. ¿El documento indica un ${percent(rate)} en la línea ${line}?`;
    }
    case "vat-amount": {
      const expected = cents(d.expectedCents);
      const printed = cents(d.printedCents);
      if (expected === undefined || printed === undefined) return undefined;
      return `El IVA impreso es ${formatMoney(printed)} pero base × tipo (por cada tipo) da ${formatMoney(expected)}. ¿El IVA del documento es ${formatMoney(printed)}?`;
    }
    case "total": {
      const expected = cents(d.expectedCents);
      const printed = cents(d.printedCents);
      if (expected === undefined || printed === undefined) return undefined;
      return `El total impreso es ${formatMoney(printed)} pero base + IVA − retención da ${formatMoney(expected)}. ¿El total del documento es ${formatMoney(printed)}?`;
    }
    case "tax-ids": {
      const party = typeof d.party === "string" ? PARTY[d.party] : undefined;
      if (!party) return undefined;
      if (d.reason === "missing") {
        return `Falta el NIF del ${party}, obligatorio en una factura completa. ¿El documento muestra el NIF del ${party}?`;
      }
      if (typeof d.value !== "string" || typeof d.reason !== "string")
        return undefined;
      return `El NIF del ${party} es «${d.value}», que no es válido: ${taxIdReason(d.reason)}. ¿El documento muestra «${d.value}» como NIF del ${party}?`;
    }
    case "issue-date": {
      if (typeof d.issueDate !== "string" || typeof d.today !== "string")
        return undefined;
      const date = spanishDate(d.issueDate);
      return `La fecha de emisión ${date} es posterior a hoy (${spanishDate(d.today)}). ¿La fecha del documento es ${date}?`;
    }
    default:
      return undefined;
  }
}

/** "Además, la línea 2 dice 42,00 € donde 3 × 12,00 € son 36,00 €." */
function lineAmountContext(issue: ReviewIssue): string | undefined {
  const d = issue.details;
  if (issue.ruleId !== "line-amount" || !d) return undefined;
  const expected = cents(d.expectedCents);
  const printed = cents(d.lineTotalCents);
  const price = cents(d.unitPriceCents);
  if (
    typeof d.line !== "number" ||
    typeof d.quantity !== "number" ||
    expected === undefined ||
    printed === undefined ||
    price === undefined
  )
    return undefined;
  return `Además, la línea ${d.line} dice ${formatMoney(printed)} donde ${spanishNumber(d.quantity)} × ${formatMoney(price)} son ${formatMoney(expected)}.`;
}

/** The validator's English reasons, as the reviewer reads them. */
function taxIdReason(reason: string): string {
  const letter = /^(?:NIF|NIE) letter should be (\w)$/.exec(reason);
  if (letter) return `la letra de control debería ser ${letter[1]}`;
  const control = /^CIF control should be (\w)$/.exec(reason);
  if (control) return `el carácter de control debería ser ${control[1]}`;
  if (reason === "not a Spanish NIF, NIE or CIF")
    return "no es un NIF, NIE ni CIF español";
  return reason;
}

function cents(value: number | string | undefined): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : undefined;
}

/** 1600 bps → "16 %", 550 → "5,5 %". */
function percent(bps: number): string {
  return `${spanishNumber(bps / 100)} %`;
}

function spanishNumber(value: number): string {
  return String(value).replace(".", ",");
}

/** "2026-10-02" → "02/10/2026". */
function spanishDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return year && month && day ? `${day}/${month}/${year}` : iso;
}
