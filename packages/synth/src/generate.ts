import { applyRate } from "@invariant/rules";
import type { Invoice, InvoiceLine } from "@invariant/schema";
import {
  CITIES,
  CUSTOMERS,
  FIRST_NAMES,
  type Product,
  SECTORS,
  STREETS,
  SURNAMES,
} from "./catalog.js";
import { createRandom, type Random } from "./random.js";
import { randomCif, randomNif } from "./tax-ids.js";
import { type SyntheticInvoice, TEMPLATE_IDS } from "./types.js";

/** IRPF withheld by self-employed professionals on their invoices. */
const IRPF_BPS = 1500;
const FIRST_DAY = Date.UTC(2025, 0, 2);

function address(random: Random): string {
  const [city, province] = random.pick(CITIES);
  const postcode = `${province}${String(random.int(1, 999)).padStart(3, "0")}`;
  return `${random.pick(STREETS)} ${random.int(1, 120)}, ${postcode} ${city}`;
}

function line(random: Random, product: Product): InvoiceLine {
  const quantity = product.fractional
    ? random.int(5, 250) / 10
    : random.int(1, 12);
  const unitPriceCents = random.int(product.price[0], product.price[1]);
  return {
    description: product.description,
    quantity,
    unitPriceCents,
    lineTotalCents: Math.round(quantity * unitPriceCents),
    vatRateBps: product.vatRateBps,
  };
}

function shuffled<T>(random: Random, items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = random.int(0, i);
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy;
}

/**
 * Generates a Spanish invoice that is correct by construction: valid tax ids,
 * VAT computed per rate like a real invoicing program, IRPF for professionals.
 * The same seed always produces the same document.
 */
export function generateInvoice(seed: number): SyntheticInvoice {
  const random = createRandom(seed);
  const sector = random.pick(SECTORS);

  const supplier = sector.professional
    ? {
        name: `${random.pick(FIRST_NAMES)} ${random.pick(SURNAMES)} ${random.pick(SURNAMES)}`,
        taxId: randomNif(random),
      }
    : random.chance(0.8)
      ? {
          name: `${random.pick(sector.names)} ${random.pick(SURNAMES)} S.L.`,
          taxId: randomCif(random, "B"),
        }
      : {
          name: `${random.pick(sector.names)} del Sur S.A.`,
          taxId: randomCif(random, "A"),
        };

  const customerName = random.pick(CUSTOMERS);
  const customer = random.chance(0.8)
    ? { name: customerName, taxId: randomCif(random, "B") }
    : { name: customerName };

  const maxLines = sector.professional ? 3 : 8;
  const products = shuffled(random, sector.products).slice(
    0,
    random.int(1, maxLines),
  );
  const lines = products.map((product) => line(random, product));

  const taxBaseCents = lines.reduce((sum, l) => sum + l.lineTotalCents, 0);
  const baseByRate = new Map<number, number>();
  for (const l of lines) {
    baseByRate.set(
      l.vatRateBps,
      (baseByRate.get(l.vatRateBps) ?? 0) + l.lineTotalCents,
    );
  }
  const vatAmountCents = [...baseByRate].reduce(
    (sum, [rate, base]) => sum + applyRate(base, rate),
    0,
  );
  const withholdingCents = sector.professional
    ? applyRate(taxBaseCents, IRPF_BPS)
    : undefined;

  const issueDate = new Date(FIRST_DAY + random.int(0, 600) * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const series = random.pick(["F", "FAC", "A"]);

  const invoice: Invoice = {
    number: `${series}-${issueDate.slice(0, 4)}-${String(random.int(1, 9999)).padStart(4, "0")}`,
    issueDate,
    currency: "EUR",
    supplier,
    customer,
    lines,
    taxBaseCents,
    vatAmountCents,
    ...(withholdingCents === undefined ? {} : { withholdingCents }),
    totalCents: taxBaseCents + vatAmountCents - (withholdingCents ?? 0),
  };

  return {
    seed,
    template: random.pick(TEMPLATE_IDS),
    invoice,
    meta: {
      sector: sector.id,
      supplierAddress: address(random),
      customerAddress: address(random),
    },
  };
}
