import type { Invoice } from "@invariant/schema";

/** Two VAT rates: 21 % on 100.00 + 25.00, 10 % on 33.33 (VAT 26.25 + 3.33). */
export const twoRates: Invoice = {
  number: "F-2026-0042",
  issueDate: "2026-09-24",
  currency: "EUR",
  supplier: { name: "Aceites García & Hijos SL", taxId: "B12345674" },
  customer: { name: "Taberna El Puerto", taxId: "12345678Z" },
  lines: [
    {
      description: "Aceite 5 L",
      quantity: 2,
      unitPriceCents: 5000,
      lineTotalCents: 10000,
      vatRateBps: 2100,
    },
    {
      description: "Harina 1,5 kg",
      quantity: 1.5,
      unitPriceCents: 2222,
      lineTotalCents: 3333,
      vatRateBps: 1000,
    },
    {
      description: "Transporte",
      quantity: 1,
      unitPriceCents: 2500,
      lineTotalCents: 2500,
      vatRateBps: 2100,
    },
  ],
  taxBaseCents: 15833,
  vatAmountCents: 2958,
  totalCents: 18791,
};

/** The FacturaScripts invoice erp-fs-000067: one rate and IRPF withholding. */
export const withIrpf: Invoice = {
  number: "F2025A1",
  issueDate: "2025-01-03",
  currency: "EUR",
  supplier: { name: "Antonio Pérez Sánchez", taxId: "37536163W" },
  customer: { name: "Taberna El Puerto", taxId: "B23603566" },
  lines: [
    {
      description: "Diseño de carta y menú",
      quantity: 2,
      unitPriceCents: 53342,
      lineTotalCents: 106684,
      vatRateBps: 2100,
    },
    {
      description: "Mantenimiento de equipos (hora)",
      quantity: 11,
      unitPriceCents: 6323,
      lineTotalCents: 69553,
      vatRateBps: 2100,
    },
  ],
  taxBaseCents: 176237,
  vatAmountCents: 37010,
  withholdingCents: 26436,
  totalCents: 186811,
};
