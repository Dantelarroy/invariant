import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright";
import { generateInvoice } from "../generate.js";
import { createRandom } from "../random.js";
import { randomAugmentation, renderDocument } from "../render.js";
import { renderHtml } from "../templates/index.js";

const { values } = parseArgs({
  options: {
    count: { type: "string", default: "20" },
    seed: { type: "string", default: "1" },
    out: { type: "string", default: "data/synth" },
  },
});
const count = Number(values.count);
const firstSeed = Number(values.seed);
// pnpm runs the script inside the package; INIT_CWD is where the user typed the command.
const out = resolve(process.env.INIT_CWD ?? process.cwd(), values.out);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const labels: string[] = [];
try {
  for (let seed = firstSeed; seed < firstSeed + count; seed++) {
    const synthetic = generateInvoice(seed);
    // A separate stream for augmentation so templates and data stay stable if it changes.
    const augmentation = randomAugmentation(createRandom(seed * 7919));
    const { pdf, image } = await renderDocument(
      browser,
      renderHtml(synthetic),
      augmentation,
    );
    const id = `synth-${String(seed).padStart(6, "0")}`;
    writeFileSync(join(out, `${id}.pdf`), pdf);
    writeFileSync(join(out, `${id}.jpg`), image);
    labels.push(JSON.stringify({ id, ...synthetic, augmentation }));
  }
} finally {
  await browser.close();
}
writeFileSync(join(out, "labels.jsonl"), `${labels.join("\n")}\n`);
console.log(
  `✔ ${count} synthetic invoices (PDF + JPEG + labels.jsonl) in ${out}`,
);
