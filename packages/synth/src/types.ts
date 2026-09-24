import type { Invoice } from "@invariant/schema";

export const TEMPLATE_IDS = ["classic", "modern", "compact"] as const;
export type TemplateId = (typeof TEMPLATE_IDS)[number];

/** A generated document: the exact ground truth plus what is only printed. */
export type SyntheticInvoice = {
  seed: number;
  template: TemplateId;
  invoice: Invoice;
  meta: {
    sector: string;
    supplierAddress: string;
    customerAddress: string;
  };
};
