import { pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

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
