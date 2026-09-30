import { existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { fetchObservations } from "../langfuse-api.js";
import { formatReport, summarizeObservations } from "../report.js";
import { langfuseSettings } from "../settings.js";

const envPath = fileURLToPath(new URL("../../../../.env", import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);

const USAGE =
  "Usage: pnpm obs:report [--since <ISO date>] [--until <ISO date>] [--env eval|pipeline]";

const { values } = parseArgs({
  options: {
    since: { type: "string" },
    until: { type: "string" },
    env: { type: "string", default: "eval" },
  },
});

const DAY_MS = 24 * 60 * 60 * 1000;
const since = values.since ?? new Date(Date.now() - DAY_MS).toISOString();
if (
  Number.isNaN(Date.parse(since)) ||
  (values.until !== undefined && Number.isNaN(Date.parse(values.until)))
) {
  console.error(USAGE);
  process.exit(1);
}
const settings = langfuseSettings(process.env);
if (!settings) {
  console.error("LANGFUSE_BASE_URL is not set (see docs/observability.md)");
  process.exit(1);
}

const query = {
  environment: values.env,
  from: new Date(since).toISOString(),
  ...(values.until ? { to: new Date(values.until).toISOString() } : {}),
};

// Ingestion is asynchronous: read until the trace count stops changing.
const MAX_READS = 10;
let observations = await fetchObservations(settings, query);
let traces = summarizeObservations(observations).traces;
let reads = 1;
while (reads < MAX_READS) {
  await sleep(3000);
  const next = await fetchObservations(settings, query);
  const nextTraces = summarizeObservations(next).traces;
  reads += 1;
  observations = next;
  if (nextTraces === traces) break;
  traces = nextTraces;
}

console.log(
  `environment ${query.environment} · since ${query.from}${query.to ? ` · until ${query.to}` : ""} · ${reads} reads`,
);
console.log(formatReport(summarizeObservations(observations)));
console.log("\nLatency is trace latency (a resumed run adds its own time).");
