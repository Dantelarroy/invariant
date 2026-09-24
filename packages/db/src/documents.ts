import { eq, inArray } from "drizzle-orm";
import type { Db } from "./client.js";
import { type Document, documents } from "./schema.js";

type DocumentStatus = Document["status"];
type DocumentSource = Document["source"];

/** Returns the document with this content hash, if it was already received. */
export async function findDocumentBySha256(
  db: Db,
  sha256: string,
): Promise<Document | undefined> {
  const [row] = await db
    .select()
    .from(documents)
    .where(eq(documents.sha256, sha256));
  return row;
}

/** Returns the document with this id, if it exists. */
export async function findDocumentById(
  db: Db,
  id: string,
): Promise<Document | undefined> {
  const [row] = await db.select().from(documents).where(eq(documents.id, id));
  return row;
}

/** Registers a new document. Fails if the same content (sha256) already exists. */
export async function createDocument(
  db: Db,
  input: {
    sha256: string;
    source: DocumentSource;
    status?: DocumentStatus;
    filename?: string | null;
  },
): Promise<Document> {
  const [row] = await db.insert(documents).values(input).returning();
  if (!row) throw new Error("Insert into documents returned no row");
  return row;
}

/** Moves a document to a new pipeline status. */
export async function setDocumentStatus(
  db: Db,
  id: string,
  status: DocumentStatus,
): Promise<void> {
  await db
    .update(documents)
    .set({ status, updatedAt: new Date() })
    .where(eq(documents.id, id));
}

/** Deletes documents by id; their invoices and lines go with them (cascade). */
export async function deleteDocuments(db: Db, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await db.delete(documents).where(inArray(documents.id, ids));
}
