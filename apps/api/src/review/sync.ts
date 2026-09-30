import type { Document } from "@invariant/db";
import type { CompletedReview, Verdict } from "@invariant/observability";
import { type Invoice, InvoiceSchema } from "@invariant/schema";
import type { ReviewDecision } from "../workflows/process-document.js";

type DocumentStatus = Document["status"];

/** What sync does with one completed review item (ADR-0013). */
export type SyncPlan =
  | {
      action: "approve" | "reject";
      itemId: string;
      documentId: string;
      runId: string;
      verdict: Verdict;
      decision: ReviewDecision;
    }
  | {
      /** Nothing to do: the run is not paused any more. */
      action: "skip";
      itemId: string;
      documentId: string;
      reason: string;
    }
  | {
      /** Needs a person: the run stays paused. */
      action: "report";
      itemId: string;
      documentId: string | undefined;
      reason: string;
    };

/**
 * The corrected output as an invoice, or why it is not one. The reviewer types
 * JSON with amounts in integer cents; `InvoiceSchema` rejects floats.
 */
export function parseCorrection(
  correction: string | undefined,
): { ok: true; invoice: Invoice } | { ok: false; reason: string } {
  if (correction === undefined || correction.trim() === "") {
    return { ok: false, reason: "verdict corrected but no corrected output" };
  }
  let json: unknown;
  try {
    json = JSON.parse(correction);
  } catch (error) {
    return {
      ok: false,
      reason: `the corrected output is not JSON: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  const parsed = InvoiceSchema.safeParse(json);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    return {
      ok: false,
      reason: `the corrected output is not a valid invoice: ${problems}`,
    };
  }
  return { ok: true, invoice: parsed.data };
}

/** The Langfuse user who set the verdict, or just "langfuse". */
function reviewerOf(review: CompletedReview): string {
  return review.reviewer ? `langfuse:${review.reviewer}` : "langfuse";
}

/**
 * Plans the resumption of every completed review (design decision 5):
 * - a review that cannot be mapped to a run is reported;
 * - a run that is no longer paused is skipped (a second sync, or the terminal
 *   review came first), and so is a document already planned in this sync;
 * - no verdict is reported;
 * - `unusable` rejects, `correct` approves the extraction, and `corrected`
 *   approves the corrected invoice when it is valid, otherwise it is reported.
 * Pure: `statuses` holds the current status of each document.
 */
export function planSync(
  reviews: readonly CompletedReview[],
  statuses: ReadonlyMap<string, DocumentStatus | undefined>,
): SyncPlan[] {
  const planned = new Set<string>();
  return reviews.map((review): SyncPlan => {
    const { itemId } = review;
    const documentId = review.generation?.documentId;
    const runId = review.generation?.runId;
    if (!documentId || !runId) {
      return {
        action: "report",
        itemId,
        documentId,
        reason: review.generation
          ? "the generation has no run id or document id"
          : `generation ${review.observationId} not found in Langfuse`,
      };
    }
    const status = statuses.get(documentId);
    if (status !== "needs_review" || planned.has(documentId)) {
      return {
        action: "skip",
        itemId,
        documentId,
        reason: planned.has(documentId)
          ? "already resolved by another item in this sync"
          : `already resolved (${status ?? "unknown document"})`,
      };
    }
    const reviewer = reviewerOf(review);
    const resolve = (
      action: "approve" | "reject",
      verdict: Verdict,
      decision: ReviewDecision,
    ): SyncPlan => {
      planned.add(documentId);
      return { action, itemId, documentId, runId, verdict, decision };
    };
    switch (review.verdict) {
      case undefined:
        return {
          action: "report",
          itemId,
          documentId,
          reason: "completed without a verdict",
        };
      case "unusable":
        return resolve("reject", "unusable", { approved: false, reviewer });
      case "correct":
        return resolve("approve", "correct", { approved: true, reviewer });
      default: {
        // "corrected"
        const correction = parseCorrection(review.correction);
        if (!correction.ok) {
          return {
            action: "report",
            itemId,
            documentId,
            reason: correction.reason,
          };
        }
        return resolve("approve", "corrected", {
          approved: true,
          reviewer,
          invoice: correction.invoice,
        });
      }
    }
  });
}
