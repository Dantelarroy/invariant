import {
  type Invoice,
  InvoiceLineSchema,
  InvoiceSchema,
} from "@invariant/schema";
import { z } from "zod";

/**
 * Schema sent to the model. Strict structured-output providers (e.g. OpenAI)
 * require every property to be present, so optional fields become `nullable`
 * here. `toInvoice` maps nulls back to "absent" and validates against the
 * canonical InvoiceSchema, which stays unchanged.
 */
const ModelPartySchema = z.object({
  name: z.string(),
  taxId: z.string().nullable(),
});

export const ModelInvoiceSchema = z.object({
  number: z.string(),
  issueDate: z.string().describe("ISO date YYYY-MM-DD"),
  currency: z.literal("EUR"),
  supplier: ModelPartySchema,
  customer: ModelPartySchema,
  lines: z.array(InvoiceLineSchema),
  taxBaseCents: z.number().int(),
  vatAmountCents: z.number().int(),
  withholdingCents: z.number().int().nullable(),
  totalCents: z.number().int(),
});

export type ModelInvoice = z.infer<typeof ModelInvoiceSchema>;

function toParty(party: ModelInvoice["supplier"]) {
  return party.taxId === null
    ? { name: party.name }
    : { name: party.name, taxId: party.taxId };
}

/** Converts model output into a canonical, validated Invoice. Throws if invalid. */
export function toInvoice(output: ModelInvoice): Invoice {
  const { withholdingCents, supplier, customer, ...rest } = output;
  return InvoiceSchema.parse({
    ...rest,
    supplier: toParty(supplier),
    customer: toParty(customer),
    ...(withholdingCents === null ? {} : { withholdingCents }),
  });
}
