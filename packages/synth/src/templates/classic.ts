import type { SyntheticInvoice } from "../types.js";
import {
  escapeHtml as e,
  formatDate,
  formatMoney,
  formatQuantity,
  formatRate,
  vatBreakdown,
} from "./format.js";

/** Traditional layout: serif font, bordered table, totals block bottom right. */
export function classic({ invoice, meta }: SyntheticInvoice): string {
  const rows = invoice.lines
    .map(
      (
        l,
      ) => `<tr><td>${e(l.description)}</td><td class="n">${formatQuantity(l.quantity)}</td>
        <td class="n">${formatMoney(l.unitPriceCents)}</td><td class="n">${formatRate(l.vatRateBps)}</td>
        <td class="n">${formatMoney(l.lineTotalCents)}</td></tr>`,
    )
    .join("");
  const vat = vatBreakdown(invoice)
    .map(
      (
        v,
      ) => `<tr><td>Base imponible ${formatRate(v.rate)}</td><td class="n">${formatMoney(v.base)}</td></tr>
        <tr><td>Cuota IVA ${formatRate(v.rate)}</td><td class="n">${formatMoney(v.vat)}</td></tr>`,
    )
    .join("");
  const irpf =
    invoice.withholdingCents === undefined
      ? ""
      : `<tr><td>Retención IRPF 15 %</td><td class="n">-${formatMoney(invoice.withholdingCents)}</td></tr>`;

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 18mm; }
    body { font-family: Georgia, "Times New Roman", serif; font-size: 11pt; color: #111; }
    h1 { font-size: 16pt; margin: 0; } .muted { color: #444; }
    .head { display: flex; justify-content: space-between; margin-bottom: 18px; }
    .box { border: 1px solid #333; padding: 8px 12px; width: 45%; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    th, td { border: 1px solid #555; padding: 5px 7px; } th { background: #eee; text-align: left; }
    .n { text-align: right; white-space: nowrap; }
    .totals { width: 45%; margin-left: auto; } .grand td { font-weight: bold; font-size: 12pt; }
  </style></head><body>
    <div class="head">
      <div><h1>${e(invoice.supplier.name)}</h1>
        <div class="muted">NIF/CIF: ${e(invoice.supplier.taxId ?? "")}</div>
        <div class="muted">${e(meta.supplierAddress)}</div></div>
      <div><h1>FACTURA</h1><div>Nº ${e(invoice.number)}</div><div>Fecha: ${formatDate(invoice.issueDate)}</div></div>
    </div>
    <div class="box"><strong>Cliente:</strong> ${e(invoice.customer.name)}<br>
      ${invoice.customer.taxId ? `CIF: ${e(invoice.customer.taxId)}<br>` : ""}${e(meta.customerAddress)}</div>
    <table><thead><tr><th>Descripción</th><th>Cant.</th><th>Precio</th><th>IVA</th><th>Importe</th></tr></thead>
      <tbody>${rows}</tbody></table>
    <table class="totals">${vat}${irpf}
      <tr class="grand"><td>TOTAL FACTURA</td><td class="n">${formatMoney(invoice.totalCents)}</td></tr></table>
  </body></html>`;
}
