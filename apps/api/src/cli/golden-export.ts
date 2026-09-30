import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  langfuseSettings,
  listCompletedReviews,
} from "@invariant/observability";
import { GoldenRecordSchema, mergeGolden } from "../review/golden.js";

const envPath = fileURLToPath(new URL("../../../../.env", import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);

// Upserts every reviewed document (correct or corrected) from the Langfuse
// review queue into the golden set (ADR-0013). Safe to re-run.
const { values } = parseArgs({
  options: { out: { type: "string" } },
});
const out = values.out
  ? // pnpm runs the script inside apps/api; INIT_CWD is where the user typed the command.
    resolve(process.env.INIT_CWD ?? process.cwd(), values.out)
  : fileURLToPath(
      new URL("../../../../data/golden/golden.jsonl", import.meta.url),
    );

const settings = langfuseSettings(process.env);
if (!settings) {
  console.error("LANGFUSE_BASE_URL is not set (see docs/review.md)");
  process.exit(1);
}

const existing = existsSync(out)
  ? readFileSync(out, "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => GoldenRecordSchema.parse(JSON.parse(line)))
  : [];
const reviews = await listCompletedReviews({ settings, fetch });
const { records, skipped } = mergeGolden(existing, reviews);
for (const { itemId, reason } of skipped)
  console.log(`! item ${itemId}: ${reason}`);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(
  out,
  records.length === 0
    ? ""
    : `${records.map((r) => JSON.stringify(r)).join("\n")}\n`,
);
const verdicts = (verdict: string) =>
  records.filter((r) => r.verdict === verdict).length;
console.log(
  `✔ ${records.length} golden records (${verdicts("correct")} correct · ${verdicts("corrected")} corrected; ${existing.length} before) · ${skipped.length} skipped · ${out}`,
);
