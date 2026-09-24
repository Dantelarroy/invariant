import {
  bigint,
  date,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

/** Where a document entered the system. */
export const documentSource = pgEnum("document_source", [
  "upload",
  "email",
  "batch",
]);

/** Lifecycle of a document through the Invariant pipeline. */
export const documentStatus = pgEnum("document_status", [
  "received",
  "processing",
  "valid",
  "needs_review",
  "rejected",
]);

/**
 * Every file that enters Invariant. The SHA-256 of the file content is unique,
 * so the same invoice uploaded twice is detected and never processed twice.
 */
export const documents = pgTable("documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  sha256: text("sha256").notNull().unique(),
  source: documentSource("source").notNull(),
  status: documentStatus("status").notNull().default("received"),
  filename: text("filename"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;

/**
 * One extracted invoice per document. Money columns are integer cents stored
 * as bigint (read back as JS numbers; safe up to ~90 trillion euros).
 */
export const invoices = pgTable("invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentId: uuid("document_id")
    .notNull()
    .unique()
    .references(() => documents.id, { onDelete: "cascade" }),
  number: text("number").notNull(),
  issueDate: date("issue_date", { mode: "string" }).notNull(),
  currency: text("currency").notNull(),
  supplierName: text("supplier_name").notNull(),
  supplierTaxId: text("supplier_tax_id"),
  customerName: text("customer_name").notNull(),
  customerTaxId: text("customer_tax_id"),
  taxBaseCents: bigint("tax_base_cents", { mode: "number" }).notNull(),
  vatAmountCents: bigint("vat_amount_cents", { mode: "number" }).notNull(),
  withholdingCents: bigint("withholding_cents", { mode: "number" }),
  totalCents: bigint("total_cents", { mode: "number" }).notNull(),
  promptVersion: text("prompt_version").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const invoiceLines = pgTable("invoice_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  invoiceId: uuid("invoice_id")
    .notNull()
    .references(() => invoices.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  description: text("description").notNull(),
  quantity: numeric("quantity", {
    precision: 14,
    scale: 4,
    mode: "number",
  }).notNull(),
  unitPriceCents: bigint("unit_price_cents", { mode: "number" }).notNull(),
  lineTotalCents: bigint("line_total_cents", { mode: "number" }).notNull(),
  vatRateBps: integer("vat_rate_bps").notNull(),
});
export type StoredInvoice = typeof invoices.$inferSelect;
