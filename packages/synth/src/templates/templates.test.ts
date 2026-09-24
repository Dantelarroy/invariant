import { describe, expect, it } from "vitest";
import { generateInvoice } from "../generate.js";
import { renderHtml, TEMPLATE_IDS } from "./index.js";

describe("invoice templates", () => {
  const synthetic = generateInvoice(9);

  it.each(TEMPLATE_IDS)(
    "%s shows the key values in Spanish format",
    (template) => {
      const html = renderHtml({ ...synthetic, template });
      const { invoice } = synthetic;
      expect(html).toContain(invoice.number);
      expect(html).toContain(invoice.supplier.taxId);
      const [y, m, d] = invoice.issueDate.split("-");
      expect(html).toContain(`${d}/${m}/${y}`);
      const euros = new Intl.NumberFormat("de-DE", {
        minimumFractionDigits: 2,
      }).format(invoice.totalCents / 100);
      expect(html).toContain(`${euros} €`);
    },
  );

  it("escapes HTML in names", () => {
    const html = renderHtml({
      ...synthetic,
      template: "classic",
      invoice: {
        ...synthetic.invoice,
        customer: { name: "Bar <Pepe> & Hijos" },
      },
    });
    expect(html).toContain("Bar &lt;Pepe&gt; &amp; Hijos");
  });
});
