import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { processDocument } from "../mastra.js";
import { createCliContext, printResult } from "./env.js";

const fileArg = process.argv[2];
if (!fileArg) {
  console.error("Usage: pnpm extract:text <path-to-invoice.txt>");
  process.exit(1);
}
// pnpm runs the script inside apps/api; INIT_CWD is where the user typed the command.
const file = resolve(process.env.INIT_CWD ?? process.cwd(), fileArg);

const { mastra, modelId, close } = createCliContext();
try {
  console.log(`model ${modelId}`);
  printResult(
    await processDocument(mastra, {
      text: readFileSync(file, "utf8"),
      filename: basename(file),
    }),
  );
} finally {
  await close();
}
