import { z } from "zod";

/**
 * The invoice contract shared by every Invariant package.
 *
 * This schema checks SHAPE (types, required fields, formats). It deliberately
 * does NOT check business sense (sums, VAT rates, tax ID checksums): that is
 * the job of `@invariant/rules`, so a malformed-but-parseable extraction can
 * still be verified, repaired or escalated instead of silently discarded.
 */

/** Money as integer cents. Never floats. */
export const Cents = z
  .number()
  .int()
  .refine(Number.isSafeInteger, "must be a safe integer");

/** VAT rate in basis points: 2100 = 21 %, 1000 = 10 %, 400 = 4 %. */
export const VatRateBps = z.number().int().min(0).max(10_000);

export const PartySchema = z.object({
  name: z.string().trim().min(1),
  taxId: z.string().trim().min(1).optional(),
});

export const InvoiceLineSchema = z.object({
  description: z.string().trim().min(1),
  /** Quantities can be fractional (1.5 kg), so they are plain numbers. */
  quantity: z.number().positive(),
  unitPriceCents: Cents,
  lineTotalCents: Cents,
  vatRateBps: VatRateBps,
});

export const InvoiceSchema = z.object({
  number: z.string().trim().min(1),
  /** ISO calendar date, e.g. "2026-09-24". */
  issueDate: z.iso.date(),
  currency: z.literal("EUR"),
  supplier: PartySchema,
  customer: PartySchema,
  lines: z.array(InvoiceLineSchema),
  taxBaseCents: Cents,
  vatAmountCents: Cents,
  /** IRPF withholding, present only on some invoices. */
  withholdingCents: Cents.optional(),
  totalCents: Cents,
});

export type Party = z.infer<typeof PartySchema>;
export type InvoiceLine = z.infer<typeof InvoiceLineSchema>;
export type Invoice = z.infer<typeof InvoiceSchema>;
