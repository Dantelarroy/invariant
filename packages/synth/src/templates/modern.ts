import type { SyntheticInvoice } from "../types.js";
import {
  escapeHtml as e,
  formatDate,
  formatMoney,
  formatQuantity,
  formatRate,
  vatBreakdown,
} from "./format.js";

/** Contemporary layout: colour band, sans-serif, customer first, big total. */
export function modern({ invoice, meta }: SyntheticInvoice): string {
  const rows = invoice.lines
    .map(
      (
        l,
      ) => `<div class="row"><span>${e(l.description)}<small>${formatRate(l.vatRateBps)} IVA</small></span>
        <span>${formatQuantity(l.quantity)} × ${formatMoney(l.unitPriceCents)}</span>
        <span class="amt">${formatMoney(l.lineTotalCents)}</span></div>`,
    )
    .join("");
  const breakdown = vatBreakdown(invoice)
    .map(
      (v) =>
        `<div class="kv"><span>IVA ${formatRate(v.rate)} s/ ${formatMoney(v.base)}</span><span>${formatMoney(v.vat)}</span></div>`,
    )
    .join("");
  const irpf =
    invoice.withholdingCents === undefined
      ? ""
      : `<div class="kv"><span>IRPF (15 %)</span><span>-${formatMoney(invoice.withholdingCents)}</span></div>`;

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 0; }
    body { font-family: "Helvetica Neue", Arial, sans-serif; font-size: 10pt; color: #1d2433; margin: 0; }
    .band { background: #1f5f8b; color: #fff; padding: 22px 28px; display: flex; justify-content: space-between; }
    .band h2 { margin: 0; font-weight: 300; letter-spacing: 3px; } main { padding: 22px 28px; }
    .cols { display: flex; gap: 40px; margin-bottom: 20px; } .label { font-size: 8pt; color: #6b7a90; text-transform: uppercase; }
    .row { display: grid; grid-template-columns: 1fr 160px 110px; padding: 8px 0; border-bottom: 1px solid #dde3ea; }
    .row small { display: block; color: #6b7a90; } .amt, .kv span:last-child { text-align: right; }
    .sum { width: 300px; margin: 18px 0 0 auto; } .kv { display: flex; justify-content: space-between; padding: 3px 0; }
    .total { background: #eef4f9; padding: 10px; font-size: 14pt; font-weight: 700; margin-top: 8px; }
  </style></head><body>
    <div class="band"><div><strong>${e(invoice.supplier.name)}</strong><br>${e(invoice.supplier.taxId ?? "")}</div>
      <h2>FACTURA</h2></div>
    <main>
      <div class="cols">
        <div><div class="label">Facturar a</div>${e(invoice.customer.name)}<br>
          ${invoice.customer.taxId ? `${e(invoice.customer.taxId)}<br>` : ""}${e(meta.customerAddress)}</div>
        <div><div class="label">Número</div>${e(invoice.number)}<div class="label">Fecha de emisión</div>${formatDate(invoice.issueDate)}</div>
        <div><div class="label">Emisor</div>${e(meta.supplierAddress)}</div>
      </div>
      ${rows}
      <div class="sum"><div class="kv"><span>Base imponible</span><span>${formatMoney(invoice.taxBaseCents)}</span></div>
        ${breakdown}${irpf}
        <div class="kv total"><span>Total</span><span>${formatMoney(invoice.totalCents)}</span></div></div>
    </main>
  </body></html>`;
}
