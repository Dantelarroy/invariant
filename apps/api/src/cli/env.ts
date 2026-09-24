import { existsSync } from "node:fs";
import { openai } from "@ai-sdk/openai";
import { createDb } from "@invariant/db";
import { formatMoney } from "@invariant/schema";
import { createInvariantMastra, type RunResult } from "../mastra.js";

const envPath = new URL("../../../../.env", import.meta.url).pathname;
if (existsSync(envPath)) process.loadEnvFile(envPath);

/** Wires the real dependencies (Postgres + OpenAI) for command-line use. */
export function createCliContext() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl)
    throw new Error("DATABASE_URL is not set (see .env.example)");
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set (see .env.example)");
  }
  const modelId = process.env.EXTRACTION_MODEL ?? "gpt-5-mini";
  const { db, close: closeDb } = createDb(databaseUrl);
  const { mastra, close: closeMastra } = createInvariantMastra({
    db,
    model: openai(modelId),
    databaseUrl,
  });
  return {
    mastra,
    modelId,
    close: async () => {
      await closeMastra();
      await closeDb();
    },
  };
}

export function printResult(result: RunResult): void {
  switch (result.kind) {
    case "accepted":
      console.log(
        `✔ accepted invoice ${result.invoiceId} · total ${formatMoney(result.totalCents)} · reviewed by ${result.reviewedBy}`,
      );
      break;
    case "rejected":
      console.log(
        `✖ rejected by ${result.reviewedBy} (document ${result.documentId})`,
      );
      break;
    case "duplicate":
      console.log(`↺ already processed (document ${result.documentId})`);
      break;
    case "failed":
      console.error(`✖ extraction failed: ${result.error}`);
      process.exitCode = 1;
      break;
    case "needs_review":
      console.log(`⏸ needs review · run ${result.runId}`);
      for (const issue of result.issues) console.log(`  - ${issue.message}`);
      console.log(`  ${result.question}`);
      console.log(`  Answer with: pnpm review ${result.runId} approve|reject`);
      break;
  }
}
