import { createHash } from "node:crypto";
import {
  createDocument,
  type Db,
  findDocumentBySha256,
  saveInvoice,
  setDocumentStatus,
} from "@invariant/db";
import { extractInvoiceFromText } from "@invariant/extractor";
import type { LanguageModel } from "ai";

export type ProcessOutcome =
  | { kind: "duplicate"; documentId: string }
  | {
      kind: "extracted";
      documentId: string;
      invoiceId: string;
      totalCents: number;
    }
  | { kind: "failed"; documentId: string; error: string };

/**
 * Day-4 pipeline: text → LLM → schema → ledger.
 * Idempotent by SHA-256: the same content is only processed once.
 * (Rule verification, repair and human review arrive on days 5–10.)
 */
export async function processTextDocument(
  db: Db,
  model: LanguageModel,
  text: string,
  filename?: string,
): Promise<ProcessOutcome> {
  const sha256 = createHash("sha256").update(text).digest("hex");

  const existing = await findDocumentBySha256(db, sha256);
  if (existing && existing.status !== "rejected") {
    return { kind: "duplicate", documentId: existing.id };
  }

  // A previously rejected document may be retried (e.g. after fixing a prompt or provider issue).
  const doc =
    existing ??
    (await createDocument(db, {
      sha256,
      source: "upload",
      status: "processing",
      filename: filename ?? null,
    }));
  if (existing) await setDocumentStatus(db, doc.id, "processing");

  try {
    const { invoice, promptVersion } = await extractInvoiceFromText(
      text,
      model,
    );
    const invoiceId = await saveInvoice(db, doc.id, invoice, promptVersion);
    // Until the rule verifier exists (day 7), extracted documents await verification.
    await setDocumentStatus(db, doc.id, "needs_review");
    return {
      kind: "extracted",
      documentId: doc.id,
      invoiceId,
      totalCents: invoice.totalCents,
    };
  } catch (error) {
    await setDocumentStatus(db, doc.id, "rejected");
    return {
      kind: "failed",
      documentId: doc.id,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
