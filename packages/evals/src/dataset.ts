import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Invoice, InvoiceSchema } from "@invariant/schema";

/** File extensions a dataset can be evaluated in, with the media type each maps to. */
export const MEDIA_TYPES = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
} as const;

export type DocumentFormat = keyof typeof MEDIA_TYPES;

/** One labeled document: the label's invoice plus where its file is. */
export type DatasetItem = {
  id: string;
  invoice: Invoice;
  path: string;
  mediaType: string;
};

/**
 * Reads `labels.jsonl` from a dataset directory, keeping its order, and maps
 * each label id to `<id>.<format>`. Applies the limit first, then checks that
 * every selected file exists, so a run fails before any model is called.
 */
export function loadDataset(
  dir: string,
  options: { format: DocumentFormat; limit?: number },
): DatasetItem[] {
  const lines = readFileSync(join(dir, "labels.jsonl"), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "");
  const selected =
    options.limit === undefined ? lines : lines.slice(0, options.limit);

  const items = selected.map((line, i): DatasetItem => {
    const label = JSON.parse(line) as { id?: unknown; invoice?: unknown };
    if (typeof label.id !== "string")
      throw new Error(`labels.jsonl line ${i + 1} has no string id.`);
    const parsed = InvoiceSchema.safeParse(label.invoice);
    if (!parsed.success)
      throw new Error(
        `Label ${label.id} is not a valid invoice: ${parsed.error.message}`,
      );
    return {
      id: label.id,
      invoice: parsed.data,
      path: join(dir, `${label.id}.${options.format}`),
      mediaType: MEDIA_TYPES[options.format],
    };
  });

  const missing = items.filter((item) => !existsSync(item.path));
  if (missing.length > 0)
    throw new Error(
      `Missing document files: ${missing.map((item) => item.path).join(", ")}`,
    );
  return items;
}
