import type { CompletedReview } from "@invariant/observability";
import { type Invoice, InvoiceSchema } from "@invariant/schema";
import { z } from "zod";
import { parseCorrection } from "./sync.js";

/** One reviewed document in `data/golden/golden.jsonl` (ADR-0013). */
export const GoldenRecordSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  verdict: z.enum(["correct", "corrected"]),
  /** The invoice as the reviewer confirmed it: "as printed", rules not required. */
  invoice: InvoiceSchema,
  /** The source text the model read. */
  text: z.string(),
  traceId: z.string(),
  observationId: z.string(),
  promptVersion: z.string(),
  reviewedAt: z.string(),
  source: z.literal("langfuse-review"),
});
export type GoldenRecord = z.infer<typeof GoldenRecordSchema>;

export interface GoldenMerge {
  /** Every record, sorted by document id. */
  records: GoldenRecord[];
  /** Completed reviews that were not exported, and why. */
  skipped: { itemId: string; reason: string }[];
}

/** The confirmed invoice of a review: the correction, or the extraction when correct. */
function confirmedInvoice(
  review: CompletedReview,
): { ok: true; invoice: Invoice } | { ok: false; reason: string } {
  if (review.verdict === "corrected") return parseCorrection(review.correction);
  const parsed = InvoiceSchema.safeParse(review.generation?.output);
  return parsed.success
    ? { ok: true, invoice: parsed.data }
    : { ok: false, reason: "the extracted invoice is not a valid invoice" };
}

/**
 * Upserts completed reviews into the golden set, by document id (design
 * decision 6). `correct` and `corrected` reviews write a record; `unusable`
 * removes one; records whose review is not listed are kept. When a document
 * was reviewed twice, the latest review wins. Pure and idempotent.
 */
export function mergeGolden(
  existing: readonly GoldenRecord[],
  reviews: readonly CompletedReview[],
): GoldenMerge {
  const byDocument = new Map(existing.map((r) => [r.documentId, r]));
  const skipped: GoldenMerge["skipped"] = [];
  const skip = (review: CompletedReview, reason: string) =>
    skipped.push({ itemId: review.itemId, reason });
  const ordered = [...reviews].sort((a, b) =>
    (a.completedAt ?? "").localeCompare(b.completedAt ?? ""),
  );
  for (const review of ordered) {
    const generation = review.generation;
    const documentId = generation?.documentId;
    if (!generation || !documentId || generation.source === undefined) {
      skip(
        review,
        "the generation, its document id or its text cannot be read",
      );
      continue;
    }
    if (review.verdict === "unusable") {
      byDocument.delete(documentId);
      continue;
    }
    if (review.verdict === undefined) {
      skip(review, "completed without a verdict");
      continue;
    }
    const confirmed = confirmedInvoice(review);
    if (!confirmed.ok) {
      skip(review, confirmed.reason);
      continue;
    }
    byDocument.set(documentId, {
      id: `golden-${documentId}`,
      documentId,
      verdict: review.verdict,
      invoice: confirmed.invoice,
      text: generation.source,
      traceId: generation.traceId,
      observationId: review.observationId,
      promptVersion: generation.promptVersion ?? "",
      reviewedAt: review.completedAt ?? "",
      source: "langfuse-review",
    });
  }
  const records = [...byDocument.values()].sort((a, b) =>
    a.documentId.localeCompare(b.documentId),
  );
  return { records, skipped };
}
