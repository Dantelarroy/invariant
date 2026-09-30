import { validateSpanishTaxId, verifyInvoice } from "@invariant/rules";
import { formatMoney, InvoiceSchema } from "@invariant/schema";
import { describe, expect, it } from "vitest";
import { generateInvoice } from "./generate.js";
import { createRandom } from "./random.js";
import {
  ERROR_KINDS,
  generateReviewFixtures,
  injectError,
  renderInvoiceText,
} from "./review-fixtures.js";

const TODAY = { today: "2026-09-30" };

/** The rule that must catch each printed error once the text is read faithfully. */
const RULE_OF = {
  "wrong-total": "total",
  "wrong-vat": "vat-amount",
  "invalid-tax-id": "tax-ids",
  "line-amount": "line-amount",
} as const;

describe("renderInvoiceText", () => {
  it("prints a plain-text invoice like fixtures/text: header, lines, VAT per rate and total", () => {
    const { invoice, meta } = generateInvoice(3);
    const text = renderInvoiceText(invoice, meta);

    expect(text).toContain(invoice.supplier.name.toUpperCase());
    expect(text).toMatch(new RegExp(`(CIF|NIF): ${invoice.supplier.taxId}`));
    expect(text).toContain(meta.supplierAddress);
    expect(text).toContain(`FACTURA Nº ${invoice.number}`);
    expect(text).toContain(`Cliente: ${invoice.customer.name}`);
    for (const line of invoice.lines) {
      expect(text).toContain(line.description);
      expect(text).toContain(formatMoney(line.lineTotalCents));
    }
    expect(text).toMatch(
      new RegExp(`TOTAL FACTURA +${formatMoney(invoice.totalCents)}\\n$`),
    );
  });

  it("prints the invoice's own VAT and base totals, even when they disagree with the lines", () => {
    const { invoice, meta } = generateInvoice(3);
    const printed = {
      ...invoice,
      vatAmountCents: invoice.vatAmountCents + 500,
    };
    const text = renderInvoiceText(printed, meta);
    const vatRows = [...text.matchAll(/Cuota IVA [\d,]+ % +(.+ €)/g)].map(
      (m) => m[1] ?? "",
    );
    const printedVat = vatRows
      .map((row) => Number(row.replace(/[.\s€]/g, "").replace(",", "")))
      .reduce((a, b) => a + b, 0);
    expect(printedVat).toBe(printed.vatAmountCents);
  });

  it("prints the withholding when there is one", () => {
    const seed = Array.from({ length: 200 }, (_, i) => i + 1).find(
      (s) => generateInvoice(s).invoice.withholdingCents !== undefined,
    ) as number;
    const { invoice, meta } = generateInvoice(seed);
    expect(renderInvoiceText(invoice, meta)).toContain(
      `-${formatMoney(invoice.withholdingCents as number)}`,
    );
  });
});

describe("injectError", () => {
  it.each(ERROR_KINDS)(
    "%s changes one printed value that its rule catches",
    (kind) => {
      for (let seed = 1; seed <= 40; seed++) {
        const { invoice } = generateInvoice(seed);
        const { printed, error } = injectError(
          invoice,
          kind,
          createRandom(seed),
        );

        expect(error.kind).toBe(kind);
        expect(error.printed).not.toEqual(error.expected);
        expect(InvoiceSchema.parse(printed)).toEqual(printed);
        const failed = verifyInvoice(printed, TODAY).violations.map(
          (v) => v.ruleId,
        );
        expect(failed, `seed ${seed}`).toContain(RULE_OF[kind]);
        // An error rule always fails, so the document goes to review.
        expect(verifyInvoice(printed, TODAY).valid, `seed ${seed}`).toBe(false);
        // The true invoice is untouched.
        expect(verifyInvoice(invoice, TODAY).valid).toBe(true);
      }
    },
  );

  it("records the true value in the error and the wrong one in the printed invoice", () => {
    const { invoice } = generateInvoice(5);
    const { printed, error } = injectError(
      invoice,
      "wrong-total",
      createRandom(5),
    );
    expect(error).toMatchObject({
      path: "totalCents",
      expected: invoice.totalCents,
      printed: printed.totalCents,
    });

    const tax = injectError(invoice, "invalid-tax-id", createRandom(5));
    expect(tax.error.path).toBe("supplier.taxId");
    expect(tax.error.expected).toBe(invoice.supplier.taxId);
    expect(validateSpanishTaxId(String(tax.error.printed)).valid).toBe(false);
  });
});

describe("generateReviewFixtures", () => {
  it("gives 12 fixtures with every error kind at least twice", () => {
    const fixtures = generateReviewFixtures({ count: 12, seed: 1 });
    expect(fixtures).toHaveLength(12);
    for (const kind of ERROR_KINDS) {
      expect(
        fixtures.filter((f) => f.manifest.error.kind === kind).length,
      ).toBeGreaterThanOrEqual(2);
    }
    expect(new Set(fixtures.map((f) => f.file)).size).toBe(12);
    expect(new Set(fixtures.map((f) => f.text)).size).toBe(12);
  });

  it("is deterministic: the same seed and count give identical files", () => {
    expect(generateReviewFixtures({ count: 12, seed: 1 })).toEqual(
      generateReviewFixtures({ count: 12, seed: 1 }),
    );
    expect(generateReviewFixtures({ count: 4, seed: 2 })).not.toEqual(
      generateReviewFixtures({ count: 4, seed: 1 }),
    );
  });

  it("keeps the true invoice in the manifest and prints the wrong value", () => {
    for (const { text, manifest } of generateReviewFixtures({
      count: 12,
      seed: 1,
    })) {
      expect(verifyInvoice(manifest.invoice, TODAY).valid).toBe(true);
      const { error } = manifest;
      // VAT is printed per rate; the rendering test checks that the rows add up.
      if (error.kind === "wrong-vat") continue;
      if (typeof error.printed === "number") {
        expect(text).toContain(formatMoney(error.printed));
      } else {
        expect(text).toContain(error.printed);
      }
      // The file name does not give the error away to the reviewer.
      expect(manifest.file).not.toContain(error.kind);
    }
  });
});
