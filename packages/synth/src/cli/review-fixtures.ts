import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { ERROR_KINDS, generateReviewFixtures } from "../review-fixtures.js";

// Text invoices with one known printed error each, to fill the review queue
// (openspec change add-review-queue). Deterministic for a seed and count.
const { values } = parseArgs({
  options: {
    count: { type: "string", default: "12" },
    seed: { type: "string", default: "1" },
    out: { type: "string", default: "data/review-fixtures" },
  },
});
const count = Number(values.count);
const seed = Number(values.seed);
if (!Number.isInteger(count) || count < 1 || !Number.isInteger(seed)) {
  console.error("Usage: pnpm synth:review [--count 12] [--seed 1] [--out dir]");
  process.exit(1);
}
// pnpm runs the script inside the package; INIT_CWD is where the user typed the command.
const out = resolve(process.env.INIT_CWD ?? process.cwd(), values.out);
mkdirSync(out, { recursive: true });

const fixtures = generateReviewFixtures({ count, seed });
for (const { file, text } of fixtures) writeFileSync(join(out, file), text);
writeFileSync(
  join(out, "manifest.jsonl"),
  `${fixtures.map((f) => JSON.stringify(f.manifest)).join("\n")}\n`,
);
const perKind = ERROR_KINDS.map(
  (kind) =>
    `${kind} ${fixtures.filter((f) => f.manifest.error.kind === kind).length}`,
).join(" · ");
console.log(`✔ ${count} review fixtures (${perKind}) in ${out}`);
