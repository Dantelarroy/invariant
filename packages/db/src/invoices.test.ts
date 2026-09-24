import { randomUUID } from "node:crypto";
import type { Invoice } from "@invariant/schema";
import { asc, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { createDb } from "./client.js";
import { saveInvoice } from "./invoices.js";
import { documents, invoiceLines, invoices } from "./schema.js";

const databaseUrl = process.env.DATABASE_URL;

const invoice: Invoice = {
  number: "F-2026-0042",
  issueDate: "2026-09-24",
  currency: "EUR",
  supplier: { name: "Aceites García SL", taxId: "B12345678" },
  customer: { name: "Restaurante Sol" },
  lines: [
    {
      description: "Aceite 5 L",
      quantity: 2,
      unitPriceCents: 3000,
      lineTotalCents: 6000,
      vatRateBps: 1000,
    },
    {
      description: "Harina 1,5 kg",
      quantity: 1.5,
      unitPriceCents: 200,
      lineTotalCents: 300,
      vatRateBps: 400,
    },
  ],
  taxBaseCents: 6300,
  vatAmountCents: 612,
  totalCents: 6912,
};

describe.skipIf(!databaseUrl)("saveInvoice (integration)", () => {
  const { db, close } = createDb(databaseUrl as string);
  const sha256 = `test-${randomUUID()}`;

  afterAll(async () => {
    await db.delete(documents).where(eq(documents.sha256, sha256)); // cascades to invoices and lines
    await close();
  });

  it("stores the invoice and its lines in order", async () => {
    const [doc] = await db
      .insert(documents)
      .values({ sha256, source: "upload" })
      .returning();
    if (!doc) throw new Error("document not created");

    const invoiceId = await saveInvoice(db, doc.id, invoice, "extract-text-v1");

    const [stored] = await db
      .select()
      .from(invoices)
      .where(eq(invoices.id, invoiceId));
    expect(stored?.totalCents).toBe(6912);
    expect(stored?.supplierTaxId).toBe("B12345678");
    expect(stored?.customerTaxId).toBeNull();
    expect(stored?.promptVersion).toBe("extract-text-v1");

    const lines = await db
      .select()
      .from(invoiceLines)
      .where(eq(invoiceLines.invoiceId, invoiceId))
      .orderBy(asc(invoiceLines.position));
    expect(lines.map((l) => l.description)).toEqual([
      "Aceite 5 L",
      "Harina 1,5 kg",
    ]);
    expect(lines[1]?.quantity).toBe(1.5);
  });
});
