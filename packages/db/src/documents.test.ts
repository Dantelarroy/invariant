import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { createDb } from "./client.js";
import {
  createDocument,
  deleteDocuments,
  findDocumentById,
} from "./documents.js";
import { documents } from "./schema.js";

const databaseUrl = process.env.DATABASE_URL;

describe.skipIf(!databaseUrl)("documents table (integration)", () => {
  const { db, close } = createDb(databaseUrl as string);
  const sha256 = `test-${randomUUID()}`;

  afterAll(async () => {
    await db.delete(documents).where(eq(documents.sha256, sha256));
    await close();
  });

  it("stores a document with status 'received' by default", async () => {
    const [created] = await db
      .insert(documents)
      .values({ sha256, source: "upload" })
      .returning();

    expect(created?.status).toBe("received");
    expect(created?.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("rejects the same file twice (unique sha256)", async () => {
    await expect(
      db.insert(documents).values({ sha256, source: "batch" }),
    ).rejects.toThrow();
  });

  it("finds a document by id and deletes documents by id", async () => {
    const doc = await createDocument(db, {
      sha256: `test-${randomUUID()}`,
      source: "upload",
    });

    expect((await findDocumentById(db, doc.id))?.sha256).toBe(doc.sha256);

    await deleteDocuments(db, [doc.id]);
    expect(await findDocumentById(db, doc.id)).toBeUndefined();
  });
});
