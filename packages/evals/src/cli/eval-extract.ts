import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { openai } from "@ai-sdk/openai";
import {
  EXTRACT_DOCUMENT_PROMPT_VERSION,
  extractInvoiceFromDocument,
} from "@invariant/extractor";
import { type DocumentFormat, loadDataset, MEDIA_TYPES } from "../dataset.js";
import { evaluateDocuments } from "../run.js";
import { SCORED_FIELDS } from "../score.js";
import { type Summary, summarize } from "../summarize.js";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const envPath = join(repoRoot, ".env");
if (existsSync(envPath)) process.loadEnvFile(envPath);

const USAGE =
  "Usage: pnpm eval:extract --dataset <dir> --model <id> [--limit 20] [--format pdf|jpg|png|webp]";

const { values } = parseArgs({
  options: {
    dataset: { type: "string" },
    model: { type: "string" },
    limit: { type: "string", default: "20" },
    format: { type: "string", default: "pdf" },
  },
});

const limit = Number(values.limit);
if (
  !values.dataset ||
  !values.model ||
  !Number.isSafeInteger(limit) ||
  limit < 1 ||
  !(values.format in MEDIA_TYPES)
) {
  console.error(USAGE);
  process.exit(1);
}
if (!process.env.OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY is not set (see .env.example)");
  process.exit(1);
}

const modelId = values.model;
const format = values.format as DocumentFormat;
// pnpm runs the script inside packages/evals; INIT_CWD is where the user typed the command.
const datasetDir = resolve(
  process.env.INIT_CWD ?? process.cwd(),
  values.dataset,
);

// Fails here, before any model call, when a label names a missing file.
const items = loadDataset(datasetDir, { format, limit });

const startedAt = new Date().toISOString();
const today = startedAt.slice(0, 10);
const model = openai(modelId);

console.log(
  `${items.length} documents · ${modelId} · ${EXTRACT_DOCUMENT_PROMPT_VERSION} · ${format}`,
);
const documents = await evaluateDocuments(
  items,
  (item) =>
    extractInvoiceFromDocument(
      { bytes: readFileSync(item.path), mediaType: item.mediaType },
      model,
    ),
  {
    today,
    onResult: (r) => {
      const status = r.error
        ? `error: ${r.error}`
        : r.score.exactMatch
          ? "exact"
          : `mismatch: ${Object.entries(r.score.fields)
              .filter(([, field]) => !field.match)
              .map(([name]) => name)
              .join(", ")}`;
      console.log(`  ${r.id}  ${r.latencyMs} ms  ${status}`);
    },
  },
);
const summary = summarize(documents);

const stamp = startedAt.replace(/[-:]/g, "").slice(0, 15);
const reportDir = join(repoRoot, "data", "evals");
const reportPath = join(
  reportDir,
  `${basename(datasetDir)}-${modelId.replace(/[^\w.-]/g, "_")}-${stamp}.json`,
);
mkdirSync(reportDir, { recursive: true });
writeFileSync(
  reportPath,
  `${JSON.stringify(
    {
      meta: {
        dataset: values.dataset,
        model: modelId,
        promptVersion: EXTRACT_DOCUMENT_PROMPT_VERSION,
        limit,
        format,
        startedAt,
      },
      summary,
      documents,
    },
    null,
    2,
  )}\n`,
);

console.log(`\n${formatSummary(summary)}\n\nreport ${reportPath}`);

/** A small aligned table: one metric per row. */
function formatSummary(s: Summary): string {
  const pct = (rate: number) => `${(rate * 100).toFixed(1)} %`;
  const rows: [string, string][] = [
    ["documents", String(s.documents)],
    ...SCORED_FIELDS.map((field): [string, string] => [
      field,
      pct(s.fieldAccuracy[field]),
    ]),
    ["exact match", pct(s.exactMatchRate)],
    ["rule pass", pct(s.rulePassRate)],
    ["failures", String(s.failures)],
    ["tokens in / out", `${s.inputTokens} / ${s.outputTokens}`],
    ["median latency", `${s.medianLatencyMs} ms`],
  ];
  const width = Math.max(...rows.map(([label]) => label.length));
  return rows
    .map(([label, value]) => `${label.padEnd(width)}  ${value.padStart(10)}`)
    .join("\n");
}
