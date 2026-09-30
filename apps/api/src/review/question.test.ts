import { describe, expect, it } from "vitest";
import { buildReviewQuestion, type ReviewIssue } from "./question.js";

const totalError: ReviewIssue = {
  ruleId: "total",
  severity: "error",
  message: "Total is 112,85 € but base + VAT − withholding is 102,85 €.",
  path: "totalCents",
  details: {
    taxBaseCents: 9000,
    vatAmountCents: 1890,
    withholdingCents: 605,
    expectedCents: 10285,
    printedCents: 11285,
  },
};

const linesSumError: ReviewIssue = {
  ruleId: "lines-sum",
  severity: "error",
  message: "Lines add up to 102,00 € but the tax base is 96,00 €.",
  path: "taxBaseCents",
  details: { linesSumCents: 10200, taxBaseCents: 9600 },
};

const lineWarning: ReviewIssue = {
  ruleId: "line-amount",
  severity: "warning",
  message: "Line 2: 3 × 12,00 € is 36,00 €, but the line says 42,00 €.",
  path: "lines[1].lineTotalCents",
  details: {
    line: 2,
    quantity: 3,
    unitPriceCents: 1200,
    expectedCents: 3600,
    lineTotalCents: 4200,
  },
};

describe("buildReviewQuestion", () => {
  it("asks about the printed total, with the spec's exact wording", () => {
    expect(buildReviewQuestion([totalError])).toBe(
      "El total impreso es 112,85 € pero base + IVA − retención da 102,85 €. ¿El total del documento es 112,85 €?",
    );
  });

  it("states the lines sum and the tax base, and adds the line warning as context", () => {
    const question = buildReviewQuestion([lineWarning, linesSumError]);

    expect(question).toBe(
      "Las líneas suman 102,00 € pero la base imponible impresa es 96,00 €. ¿La base imponible del documento es 96,00 €? Además, la línea 2 dice 42,00 € donde 3 × 12,00 € son 36,00 €.",
    );
  });

  it("names the customer, the value read and why it is invalid", () => {
    const question = buildReviewQuestion([
      {
        ruleId: "tax-ids",
        severity: "error",
        message:
          'The customer\'s tax id "12345678A" is not valid: NIF letter should be Z.',
        path: "customer.taxId",
        details: {
          party: "customer",
          value: "12345678A",
          reason: "NIF letter should be Z",
        },
      },
    ]);

    expect(question).toBe(
      "El NIF del cliente es «12345678A», que no es válido: la letra de control debería ser Z. ¿El documento muestra «12345678A» como NIF del cliente?",
    );
  });

  it("asks whether the supplier's tax id appears when it is missing", () => {
    expect(
      buildReviewQuestion([
        {
          ruleId: "tax-ids",
          severity: "error",
          message: "The supplier's tax id is missing.",
          path: "supplier.taxId",
          details: { party: "supplier", reason: "missing" },
        },
      ]),
    ).toBe(
      "Falta el NIF del proveedor, obligatorio en una factura completa. ¿El documento muestra el NIF del proveedor?",
    );
  });

  it("translates a CIF control reason and an unknown format", () => {
    const taxIdIssue = (value: string, reason: string): ReviewIssue => ({
      ruleId: "tax-ids",
      severity: "error",
      message: "(unused)",
      details: { party: "supplier", value, reason },
    });

    expect(
      buildReviewQuestion([taxIdIssue("B12345678", "CIF control should be 4")]),
    ).toContain("que no es válido: el carácter de control debería ser 4.");
    expect(
      buildReviewQuestion([taxIdIssue("ABC", "not a Spanish NIF, NIE or CIF")]),
    ).toContain("que no es válido: no es un NIF, NIE ni CIF español.");
  });

  it("asks about the printed VAT", () => {
    expect(
      buildReviewQuestion([
        {
          ruleId: "vat-amount",
          severity: "error",
          message:
            "VAT should be 6,12 € (base × rate, per rate) but the invoice says 6,30 €.",
          details: { expectedCents: 612, printedCents: 630 },
        },
      ]),
    ).toBe(
      "El IVA impreso es 6,30 € pero base × tipo (por cada tipo) da 6,12 €. ¿El IVA del documento es 6,30 €?",
    );
  });

  it("asks about a VAT rate that does not exist in Spain", () => {
    expect(
      buildReviewQuestion([
        {
          ruleId: "vat-rate",
          severity: "error",
          message: "Line 1: 16 % is not a Spanish VAT rate on 2026-09-24.",
          details: { line: 1, rateBps: 1600 },
        },
      ]),
    ).toBe(
      "La línea 1 tiene un IVA del 16 %, que no es un tipo vigente en España. ¿El documento indica un 16 % en la línea 1?",
    );
    expect(
      buildReviewQuestion([
        {
          ruleId: "vat-rate",
          severity: "error",
          message: "(unused)",
          details: { line: 3, rateBps: 550 },
        },
      ]),
    ).toContain("un IVA del 5,5 %");
  });

  it("asks about an issue date in the future, with Spanish dates", () => {
    expect(
      buildReviewQuestion([
        {
          ruleId: "issue-date",
          severity: "error",
          message:
            "The issue date 2026-10-02 is in the future (today is 2026-09-30).",
          details: { issueDate: "2026-10-02", today: "2026-09-30" },
        },
      ]),
    ).toBe(
      "La fecha de emisión 02/10/2026 es posterior a hoy (30/09/2026). ¿La fecha del documento es 02/10/2026?",
    );
  });

  it("asks about the first error in rule order, not in list order", () => {
    expect(buildReviewQuestion([totalError, linesSumError])).toMatch(
      /^Las líneas suman/,
    );
  });

  it("falls back to a general question when the error has no details", () => {
    expect(
      buildReviewQuestion([
        { ruleId: "total", severity: "error", message: "Total is wrong." },
      ]),
    ).toBe(
      "Algunas reglas de negocio fallan. ¿La extracción es fiel al documento?",
    );
  });
});
