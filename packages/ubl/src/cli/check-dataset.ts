import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { loadDataset } from "@invariant/evals";
import { type CheckReport, checkDocuments } from "../check.js";
import { DEFAULT_VALIDATOR_URL, validateUbl } from "../validate.js";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const envPath = join(repoRoot, ".env");
if (existsSync(envPath)) process.loadEnvFile(envPath);

const USAGE = "Usage: pnpm ubl:check --dataset <dir> [--limit N]";

const { values } = parseArgs({
  options: {
    dataset: { type: "string" },
    limit: { type: "string" },
  },
});

const limit = values.limit === undefined ? undefined : Number(values.limit);
if (
  !values.dataset ||
  (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1))
) {
  console.error(USAGE);
  process.exit(1);
}

const url = process.env.EN16931_VALIDATOR_URL ?? DEFAULT_VALIDATOR_URL;
// pnpm runs the script inside packages/ubl; INIT_CWD is where the user typed the command.
const datasetDir = resolve(
  process.env.INIT_CWD ?? process.cwd(),
  values.dataset,
);
// Only the labels are needed; every labeled document has its printed PDF.
const items = loadDataset(datasetDir, {
  format: "pdf",
  ...(limit === undefined ? {} : { limit }),
});

console.log(`${items.length} documents · ${values.dataset} · ${url}`);
const report = await checkDocuments(items, (xml) => validateUbl(xml, { url }), {
  onResult: (check) => {
    if (check.status === "valid") return;
    const detail =
      check.status === "refused"
        ? check.reasons.join(" ")
        : (check.result?.errors ?? []).map((e) => e.ruleId).join(", ");
    console.log(`  ${check.id}  ${check.status}: ${detail}`);
  },
});
console.log(`\n${formatReport(report)}`);
process.exit(report.invalid > 0 ? 1 : 0);

function formatReport(r: CheckReport): string {
  const section = (
    title: string,
    rows: { key: string; count: number; examples: string[] }[],
  ) =>
    rows.length === 0
      ? []
      : [
          "",
          title,
          ...rows.map(
            (row) =>
              `  ${String(row.count).padStart(4)}  ${row.key}  (e.g. ${row.examples.join(", ")})`,
          ),
        ];
  return [
    `documents  ${String(r.documents).padStart(4)}`,
    `valid      ${String(r.valid).padStart(4)}`,
    `refused    ${String(r.refused).padStart(4)}`,
    `invalid    ${String(r.invalid).padStart(4)}`,
    ...section(
      "refusals (documents per reason)",
      r.refusals.map((t) => ({ ...t, key: t.reason })),
    ),
    ...section(
      "errors (documents per EN16931 rule)",
      r.errors.map((t) => ({ ...t, key: t.ruleId })),
    ),
    ...section(
      "warnings (documents per EN16931 rule, not counted as invalid)",
      r.warnings.map((t) => ({ ...t, key: t.ruleId })),
    ),
  ].join("\n");
}
