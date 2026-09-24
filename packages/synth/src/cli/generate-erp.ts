import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { verifyInvoice } from "@invariant/rules";
import type { Invoice } from "@invariant/schema";
import { FacturaScriptsClient } from "../erp/facturascripts.js";
import { ERP_API_KEY, ERP_URL } from "../erp/setup.js";
import { generateInvoice } from "../generate.js";

const { values } = parseArgs({
  options: {
    count: { type: "string", default: "20" },
    seed: { type: "string", default: "1" },
    out: { type: "string", default: "data/synth-erp" },
  },
});
const count = Number(values.count);
const firstSeed = Number(values.seed);
const out = resolve(process.env.INIT_CWD ?? process.cwd(), values.out);
mkdirSync(out, { recursive: true });

const erp = new FacturaScriptsClient(ERP_URL, ERP_API_KEY);
const labels: string[] = [];
let disagreements = 0;

// Spanish invoices in a series must be numbered in date order, and FacturaScripts
// enforces it ("toda factura debe tener una fecha anterior o igual a la siguiente").
// A real company issues them over time, so we create them sorted by date.
const batch = Array.from({ length: count }, (_, i) =>
  generateInvoice(firstSeed + i),
).sort(
  (a, b) =>
    a.invoice.issueDate.localeCompare(b.invoice.issueDate) || a.seed - b.seed,
);

for (const { seed, invoice, meta } of batch) {
  const id = `erp-fs-${String(seed).padStart(6, "0")}`;

  await erp.setCompany({
    name: invoice.supplier.name,
    taxId: invoice.supplier.taxId ?? "",
    address: meta.supplierAddress,
  });
  const customerCode = `C${seed}`;
  await erp.upsertCustomer({
    code: customerCode,
    name: invoice.customer.name,
    ...(invoice.customer.taxId ? { taxId: invoice.customer.taxId } : {}),
    address: meta.customerAddress,
  });
  const created = await erp.createInvoice({
    customerCode,
    issueDate: invoice.issueDate,
    lines: invoice.lines.map((l) => ({
      ...l,
      ...(invoice.withholdingCents !== undefined ? { irpfBps: 1500 } : {}),
    })),
  });
  await erp.issueInvoice(created.id);
  writeFileSync(join(out, `${id}.pdf`), await erp.exportInvoicePdf(created.id));

  // The label is what the software printed: its number and its totals.
  const printed: Invoice = {
    ...invoice,
    number: created.number,
    taxBaseCents: created.taxBaseCents,
    vatAmountCents: created.vatAmountCents,
    totalCents: created.totalCents,
  };
  if (created.withholdingCents > 0)
    printed.withholdingCents = created.withholdingCents;
  else delete printed.withholdingCents;

  const agrees =
    printed.totalCents === invoice.totalCents &&
    printed.vatAmountCents === invoice.vatAmountCents;
  if (!agrees) disagreements++;
  const { violations } = verifyInvoice(printed);
  labels.push(
    JSON.stringify({
      id,
      seed,
      source: "facturascripts",
      invoice: printed,
      agreesWithGenerator: agrees,
      violations,
    }),
  );
  console.log(
    `${agrees ? "✔" : "≠"} ${id} ${created.number} total ${created.totalCents / 100} €`,
  );
}

writeFileSync(join(out, "labels.jsonl"), `${labels.join("\n")}\n`);
console.log(
  `✔ ${count} FacturaScripts invoices in ${out} (${disagreements} disagree with our generator)`,
);
