import { userInfo } from "node:os";
import { reviewDocument } from "../mastra.js";
import { createCliContext, printResult } from "./env.js";

const [runId, answer] = process.argv.slice(2);
if (!runId || (answer !== "approve" && answer !== "reject")) {
  console.error("Usage: pnpm review <run-id> approve|reject");
  process.exit(1);
}

const { mastra, close } = createCliContext();
try {
  printResult(
    await reviewDocument(mastra, runId, {
      approved: answer === "approve",
      reviewer: userInfo().username,
    }),
  );
} finally {
  await close();
}
