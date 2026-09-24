import type { Browser } from "playwright";
import type { Random } from "./random.js";

/** How a clean document is degraded to look like a phone photo or a scan. */
export type Augmentation = {
  rotationDeg: number;
  blurPx: number;
  noiseOpacity: number;
  /** Paper tint, as a CSS colour. */
  paper: string;
  jpegQuality: number;
};

export const CLEAN: Augmentation = {
  rotationDeg: 0,
  blurPx: 0,
  noiseOpacity: 0,
  paper: "#ffffff",
  jpegQuality: 95,
};

export function randomAugmentation(random: Random): Augmentation {
  return {
    rotationDeg: (random.next() - 0.5) * 3, // ±1.5°
    blurPx: random.next() * 0.9,
    noiseOpacity: random.next() * 0.25,
    paper: random.pick(["#ffffff", "#fbf8f0", "#f4f1ea", "#eef0f2"]),
    jpegQuality: random.int(45, 90),
  };
}

/** SVG turbulence as a data URI: grain laid over the page, no image library needed. */
const NOISE = `url("data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2"/></filter><rect width="100%" height="100%" filter="url(#n)"/></svg>',
)}")`;

function degradeCss(a: Augmentation): string {
  return `
    html { background: ${a.paper}; }
    /* Print margins (@page) do not apply to screenshots, so add them here. */
    body { padding: 28px 32px; box-sizing: border-box;
           transform: rotate(${a.rotationDeg.toFixed(2)}deg); transform-origin: 50% 30%;
           filter: blur(${a.blurPx.toFixed(2)}px); }
    html::after { content: ""; position: fixed; inset: 0; pointer-events: none;
                  background-image: ${NOISE}; opacity: ${a.noiseOpacity.toFixed(2)}; mix-blend-mode: multiply; }`;
}

/**
 * Renders HTML twice: a clean PDF (a digitally generated invoice) and a
 * degraded JPEG (the same invoice photographed or scanned).
 */
export async function renderDocument(
  browser: Browser,
  html: string,
  augmentation: Augmentation,
): Promise<{ pdf: Buffer; image: Buffer }> {
  const page = await browser.newPage({
    viewport: { width: 794, height: 1123 },
  }); // A4 at 96 dpi
  try {
    await page.setContent(html, { waitUntil: "load" });
    const pdf = await page.pdf({
      preferCSSPageSize: true,
      printBackground: true,
    });
    await page.addStyleTag({ content: degradeCss(augmentation) });
    const image = await page.screenshot({
      type: "jpeg",
      quality: augmentation.jpegQuality,
      fullPage: true,
    });
    return { pdf, image };
  } finally {
    await page.close();
  }
}
