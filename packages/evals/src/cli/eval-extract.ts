import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { openai } from "@ai-sdk/openai";
import {
  EXTRACT_DOCUMENT_PROMPT,
  EXTRACT_DOCUMENT_PROMPT_VERSION,
  extractInvoiceFromDocument,
  REPAIR_PROMPT,
  REPAIR_PROMPT_VERSION,
  repairInvoice,
} from "@invariant/extractor";
import {
  createEvalTracer,
  createPromptResolver,
} from "@invariant/observability";
import {
  type DatasetItem,
  type DocumentFormat,
  loadDataset,
  MEDIA_TYPES,
} from "../dataset.js";
import { evaluateDocuments } from "../run.js";
import { SCORED_FIELDS } from "../score.js";
import {
  type RepairSummary,
  type Summary,
  summarize,
  summarizeRepair,
} from "../summarize.js";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const envPath = join(repoRoot, ".env");
if (existsSync(envPath)) process.loadEnvFile(envPath);

const USAGE =
  "Usage: pnpm eval:extract --dataset <dir> [--model gpt-5-mini] [--limit 20] [--format pdf|jpg|png|webp] [--repair]";

const { values } = parseArgs({
  options: {
    dataset: { type: "string" },
    model: { type: "string" },
    limit: { type: "string", default: "20" },
    format: { type: "string", default: "pdf" },
    // Repair documents with rule errors once and report before and after (ADR-0010).
    repair: { type: "boolean", default: false },
  },
});

const limit = Number(values.limit);
if (
  !values.dataset ||
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

// Same default as the API's EXTRACTION_MODEL.
const modelId = values.model ?? process.env.EXTRACTION_MODEL ?? "gpt-5-mini";
const format = values.format as DocumentFormat;
const withRepair = values.repair === true;
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

const documentOf = (item: DatasetItem) => ({
  bytes: readFileSync(item.path),
  mediaType: item.mediaType,
});

// The pinned prompt versions, from the Langfuse registry when it serves them (ADR-0012).
const resolvePrompt = createPromptResolver(process.env);
const extractPrompt = await resolvePrompt(EXTRACT_DOCUMENT_PROMPT);
const repairPrompt = withRepair
  ? await resolvePrompt(REPAIR_PROMPT)
  : undefined;

// One trace per document in Langfuse, only when LANGFUSE_BASE_URL is set (ADR-0011).
const tracer = createEvalTracer(process.env, {
  dataset: values.dataset,
  model: modelId,
  promptVersion: EXTRACT_DOCUMENT_PROMPT_VERSION,
  ...(withRepair ? { repairPromptVersion: REPAIR_PROMPT_VERSION } : {}),
  prompts: { extract: extractPrompt.link, repair: repairPrompt?.link },
});

console.log(
  `${items.length} documents · ${modelId} · ${EXTRACT_DOCUMENT_PROMPT_VERSION}${withRepair ? ` + ${REPAIR_PROMPT_VERSION}` : ""} · ${format}`,
);
if (tracer) console.log(`tracing to ${process.env.LANGFUSE_BASE_URL}`);
const documents = await evaluateDocuments(
  items,
  (item) =>
    extractInvoiceFromDocument(documentOf(item), model, {
      instructions: extractPrompt.text,
    }),
  {
    today,
    ...(tracer ? { tracer } : {}),
    ...(withRepair
      ? {
          repair: (item, issues) =>
            repairInvoice({ document: documentOf(item) }, issues, model, {
              ...(repairPrompt ? { instructions: repairPrompt.text } : {}),
            }),
        }
      : {}),
    onResult: (r) => {
      const status = r.error
        ? `error: ${r.error}`
        : r.score.exactMatch
          ? "exact"
          : `mismatch: ${Object.entries(r.score.fields)
              .filter(([, field]) => !field.match)
              .map(([name]) => name)
              .join(", ")}`;
      const repair = !r.repair?.attempted
        ? ""
        : r.repair.error
          ? `  (repair failed: ${r.repair.error})`
          : r.repair.used
            ? "  (repaired)"
            : "  (repair not used)";
      console.log(`  ${r.id}  ${r.latencyMs} ms  ${status}${repair}`);
    },
  },
);
// Sends the pending traces before anything else can exit the process.
await tracer?.shutdown();
const summary = summarize(documents);
const repairSummary = withRepair ? summarizeRepair(documents) : undefined;

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
        ...(repairSummary
          ? { repairPromptVersion: REPAIR_PROMPT_VERSION }
          : {}),
        limit,
        format,
        startedAt,
      },
      // With --repair, `summary` is after repair and `repair` holds both sides.
      summary,
      ...(repairSummary ? { repair: repairSummary } : {}),
      documents,
    },
    null,
    2,
  )}\n`,
);

const table = repairSummary
  ? formatRepairSummary(repairSummary)
  : formatSummary(summary);
console.log(`\n${table}\n\nreport ${reportPath}`);

function pct(rate: number): string {
  return `${(rate * 100).toFixed(1)} %`;
}

/** One metric per row, as [label, value]. */
function summaryRows(s: Summary): [string, string][] {
  return [
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
}

/** A small aligned table: one metric per row. */
function formatSummary(s: Summary): string {
  const rows = summaryRows(s);
  const width = Math.max(...rows.map(([label]) => label.length));
  return rows
    .map(([label, value]) => `${label.padEnd(width)}  ${value.padStart(10)}`)
    .join("\n");
}

/** Before and after repair side by side, then the repair counts. */
function formatRepairSummary(r: RepairSummary): string {
  const after = summaryRows(r.after);
  const rows: [string, string, string][] = [
    ["", "before", "after"],
    ...summaryRows(r.before).map(
      ([label, value], i): [string, string, string] => [
        label,
        value,
        after[i]?.[1] ?? "",
      ],
    ),
    ["repairs attempted", "", String(r.repairsAttempted)],
    ["repairs used", "", String(r.repairsUsed)],
  ];
  const width = Math.max(...rows.map(([label]) => label.length));
  return rows
    .map(
      ([label, before, afterValue]) =>
        `${label.padEnd(width)}  ${before.padStart(16)}  ${afterValue.padStart(16)}`,
    )
    .join("\n");
}
