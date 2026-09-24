import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { openai } from "@ai-sdk/openai";
import { createDb } from "@invariant/db";
import { formatMoney } from "@invariant/schema";
import { processTextDocument } from "../process-text-document.js";

const envPath = new URL("../../../../.env", import.meta.url).pathname;
if (existsSync(envPath)) process.loadEnvFile(envPath);

const fileArg = process.argv[2];
if (!fileArg) {
  console.error("Usage: pnpm extract:text <path-to-invoice.txt>");
  process.exit(1);
}
// pnpm runs the script inside apps/api; INIT_CWD is where the user typed the command.
const file = resolve(process.env.INIT_CWD ?? process.cwd(), fileArg);

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not set (see .env.example)");
if (!process.env.OPENAI_API_KEY) {
  throw new Error("OPENAI_API_KEY is not set (see .env.example)");
}

const modelId = process.env.EXTRACTION_MODEL ?? "gpt-5-mini";
const { db, close } = createDb(databaseUrl);

try {
  const outcome = await processTextDocument(
    db,
    openai(modelId),
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
