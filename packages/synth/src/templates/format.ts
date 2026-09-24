import { applyRate } from "@invariant/rules";
import { formatMoney, type Invoice } from "@invariant/schema";

export { formatMoney };

export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** "2026-09-24" → "24/09/2026" */
export function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

/** 1.5 → "1,5" */
export function formatQuantity(quantity: number): string {
  return String(quantity).replace(".", ",");
}

export function formatRate(bps: number): string {
  return `${String(bps / 100).replace(".", ",")} %`;
}

/** One row per VAT rate: base, rate and VAT amount, as Spanish invoices print them. */
export function vatBreakdown(
  invoice: Invoice,
): { rate: number; base: number; vat: number }[] {
  const baseByRate = new Map<number, number>();
  for (const l of invoice.lines) {
    baseByRate.set(
      l.vatRateBps,
      (baseByRate.get(l.vatRateBps) ?? 0) + l.lineTotalCents,
    );
  }
  return [...baseByRate]
    .sort(([a], [b]) => b - a)
    .map(([rate, base]) => ({
      rate,
      base,
      vat: applyRate(base, rate),
    }));
}
