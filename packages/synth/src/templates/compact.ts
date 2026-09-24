import type { SyntheticInvoice } from "../types.js";
import {
  escapeHtml as e,
  formatDate,
  formatMoney,
  formatQuantity,
  formatRate,
  vatBreakdown,
} from "./format.js";

/** Narrow, monospaced layout like a till or a small invoicing app. */
export function compact({ invoice, meta }: SyntheticInvoice): string {
  const rows = invoice.lines
    .map(
      (l) => `<div>${e(l.description)}</div>
        <div class="r">${formatQuantity(l.quantity)} x ${formatMoney(l.unitPriceCents)} (${formatRate(l.vatRateBps)}) &nbsp; ${formatMoney(l.lineTotalCents)}</div>`,
    )
    .join("");
  const vat = vatBreakdown(invoice)
    .map(
      (v) =>
        `<div class="r">${formatRate(v.rate)}: ${formatMoney(v.base)} → ${formatMoney(v.vat)}</div>`,
    )
    .join("");
  const irpf =
    invoice.withholdingCents === undefined
      ? ""
      : `<div class="r">RET. IRPF: -${formatMoney(invoice.withholdingCents)}</div>`;

  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><style>
    @page { size: 90mm 250mm; margin: 6mm; }
    body { font-family: "Courier New", monospace; font-size: 9pt; width: 78mm; margin: 0 auto; }
    .c { text-align: center; } .r { text-align: right; } hr { border: 0; border-top: 1px dashed #000; }
    .big { font-size: 12pt; font-weight: bold; }
  </style></head><body>
    <div class="c"><strong>${e(invoice.supplier.name)}</strong><br>NIF ${e(invoice.supplier.taxId ?? "")}<br>${e(meta.supplierAddress)}</div>
    <hr><div>FACTURA ${e(invoice.number)}</div><div>FECHA ${formatDate(invoice.issueDate)}</div>
    <div>CLIENTE ${e(invoice.customer.name)}${invoice.customer.taxId ? ` · ${e(invoice.customer.taxId)}` : ""}</div>
    <hr>${rows}<hr>
    <div class="r">BASE: ${formatMoney(invoice.taxBaseCents)}</div>${vat}${irpf}
    <div class="r big">TOTAL: ${formatMoney(invoice.totalCents)}</div>
    <hr><div class="c">Gracias por su confianza</div>
  </body></html>`;
}
