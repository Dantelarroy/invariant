import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PROMPTS } from "@invariant/extractor";
import { createPromptVersion, fetchPromptVersions } from "../langfuse-api.js";
import { planSeed } from "../seed.js";
import { langfuseSettings } from "../settings.js";

const envPath = fileURLToPath(new URL("../../../../.env", import.meta.url));
if (existsSync(envPath)) process.loadEnvFile(envPath);

// Registers every prompt version defined in code in the Langfuse prompt
// registry (ADR-0012). Idempotent; fails without writing on drift.
const settings = langfuseSettings(process.env);
if (!settings) {
  console.error("LANGFUSE_BASE_URL is not set (see docs/observability.md)");
  process.exit(1);
}

const families = [...new Set(PROMPTS.map((prompt) => prompt.name))];
const plan = planSeed(PROMPTS, await fetchPromptVersions(settings, families));
if (!plan.ok) {
  for (const error of plan.errors) console.error(`✖ ${error}`);
  console.error("Nothing was written.");
  process.exit(1);
}

let created = 0;
for (const { action, prompt } of plan.actions) {
  const id = `${prompt.name}-v${prompt.version}`;
  if (action === "skip") {
    console.log(`= ${id} already registered`);
    continue;
  }
  const version = await createPromptVersion(settings, prompt);
  if (version !== prompt.version) {
    // Someone registered a version in between: stop before numbering drifts further.
    console.error(
      `✖ ${id} was registered as version ${version}; fix the registry by hand`,
    );
    process.exit(1);
  }
  created += 1;
  console.log(`+ ${id} created`);
}
console.log(
  `${created} created · ${plan.actions.length - created} already registered`,
);
