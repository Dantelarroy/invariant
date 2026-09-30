import { type Document, findDocumentById } from "@invariant/db";
import {
  langfuseSettings,
  listCompletedReviews,
} from "@invariant/observability";
import { reviewDocument } from "../mastra.js";
import { planSync } from "../review/sync.js";
import { createCliContext, printResult } from "./env.js";

// Resumes every paused run whose review was completed in the Langfuse queue
// (ADR-0013). Safe to re-run: runs that are no longer paused are skipped.
const settings = langfuseSettings(process.env);
if (!settings) {
  console.error("LANGFUSE_BASE_URL is not set (see docs/review.md)");
  process.exit(1);
}

const { mastra, db, close } = createCliContext();
try {
  const reviews = await listCompletedReviews({ settings, fetch });
  const statuses = new Map<string, Document["status"] | undefined>();
  for (const review of reviews) {
    const documentId = review.generation?.documentId;
    if (documentId && !statuses.has(documentId)) {
      statuses.set(
        documentId,
        (await findDocumentById(db, documentId))?.status,
      );
    }
  }
  const counts = { resumed: 0, skipped: 0, reported: 0 };
  for (const plan of planSync(reviews, statuses)) {
    const label = `item ${plan.itemId} · document ${plan.documentId ?? "?"}`;
    if (plan.action === "skip") {
      counts.skipped += 1;
      console.log(`= ${label}: ${plan.reason}`);
      continue;
    }
    if (plan.action === "report") {
      counts.reported += 1;
      console.log(`! ${label}: ${plan.reason}`);
      continue;
    }
    try {
      console.log(`→ ${label}: ${plan.verdict}`);
      printResult(await reviewDocument(mastra, plan.runId, plan.decision));
      counts.resumed += 1;
    } catch (error) {
      counts.reported += 1;
      console.log(`! ${label}: resume failed: ${String(error)}`);
    }
  }
  console.log(
    `${reviews.length} completed reviews · ${counts.resumed} resumed · ${counts.skipped} already resolved · ${counts.reported} need attention`,
  );
} finally {
  await close();
}
