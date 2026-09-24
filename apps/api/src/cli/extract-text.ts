import { existsSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { google } from "@ai-sdk/google";
import { createDb } from "@invariant/db";
import { formatMoney } from "@invariant/schema";
import { processTextDocument } from "../process-text-document.js";

const envPath = new URL("../../../../.env", import.meta.url).pathname;
if (existsSync(envPath)) process.loadEnvFile(envPath);

const file = process.argv[2];
if (!file) {
  console.error("Usage: pnpm extract:text <path-to-invoice.txt>");
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set (see .env.example)");
if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
  throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is not set (see .env.example)");
}

const modelId = process.env.EXTRACTION_MODEL ?? "gemini-2.5-flash";
const { db, close } = createDb(databaseUrl);

try {
  const outcome = await processTextDocument(
    db,
    google(modelId),
    readFileSync(file, "utf8"),
    basename(file),
  );
  if (outcome.kind === "extracted") {
    console.log(
      `✔ extracted invoice ${outcome.invoiceId} · total ${formatMoney(outcome.totalCents)} · model ${modelId}`,
    );
  } else if (outcome.kind === "duplicate") {
    console.log(`↺ already processed (document ${outcome.documentId})`);
  } else {
    console.error(`✖ extraction failed: ${outcome.error}`);
    process.exitCode = 1;
  }
} finally {
  await close();
}
