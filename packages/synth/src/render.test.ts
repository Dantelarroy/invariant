import { existsSync } from "node:fs";
import { type Browser, chromium } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateInvoice } from "./generate.js";
import { createRandom } from "./random.js";
import { CLEAN, randomAugmentation, renderDocument } from "./render.js";
import { renderHtml } from "./templates/index.js";

// Needs a browser: `pnpm exec playwright install chromium` (CI installs it).
const hasBrowser = existsSync(chromium.executablePath());

describe.skipIf(!hasBrowser)("renderDocument (browser)", () => {
  let browser: Browser;
  beforeAll(async () => {
    browser = await chromium.launch();
  });
  afterAll(async () => {
    await browser?.close();
  });

  it("produces a PDF and a JPEG for every template", async () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const synthetic = generateInvoice(seed);
      const { pdf, image } = await renderDocument(
        browser,
        renderHtml(synthetic),
        randomAugmentation(createRandom(seed)),
      );
      expect(pdf.subarray(0, 4).toString()).toBe("%PDF");
      expect([...image.subarray(0, 2)]).toEqual([0xff, 0xd8]); // JPEG magic bytes
    }
  });

  it("degrades the image: a noisy render differs from a clean one", async () => {
    const html = renderHtml(generateInvoice(1));
    const clean = await renderDocument(browser, html, CLEAN);
    const noisy = await renderDocument(browser, html, {
      ...CLEAN,
      rotationDeg: 1.2,
      noiseOpacity: 0.2,
      jpegQuality: 50,
    });
    expect(noisy.image.equals(clean.image)).toBe(false);
  });
});
