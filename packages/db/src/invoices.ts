import type { Invoice } from "@invariant/schema";
import { eq } from "drizzle-orm";
import type { Db } from "./client.js";
import { invoiceLines, invoices, type StoredInvoice } from "./schema.js";

/**
 * Persists an extracted invoice and its lines for a document, atomically.
 * Returns the new invoice id.
 */
export async function saveInvoice(
  db: Db,
  documentId: string,
  invoice: Invoice,
  promptVersion: string,
): Promise<string> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(invoices)
      .values({
        documentId,
        number: invoice.number,
        issueDate: invoice.issueDate,
        currency: invoice.currency,
        supplierName: invoice.supplier.name,
        supplierTaxId: invoice.supplier.taxId ?? null,
        customerName: invoice.customer.name,
        customerTaxId: invoice.customer.taxId ?? null,
        taxBaseCents: invoice.taxBaseCents,
        vatAmountCents: invoice.vatAmountCents,
        withholdingCents: invoice.withholdingCents ?? null,
        totalCents: invoice.totalCents,
        promptVersion,
      })
      .returning({ id: invoices.id });

    if (!row) throw new Error("Insert into invoices returned no row");

    if (invoice.lines.length > 0) {
      await tx.insert(invoiceLines).values(
        invoice.lines.map((line, position) => ({
          invoiceId: row.id,
          position,
          description: line.description,
          quantity: line.quantity,
          unitPriceCents: line.unitPriceCents,
          lineTotalCents: line.lineTotalCents,
          vatRateBps: line.vatRateBps,
        })),
      );
    }

    return row.id;
  });
}

/** Returns the invoice extracted from a document, if one was stored. */
export async function findInvoiceByDocumentId(
  db: Db,
  documentId: string,
): Promise<StoredInvoice | undefined> {
  const [row] = await db
    .select()
    .from(invoices)
    .where(eq(invoices.documentId, documentId));
  return row;
}
