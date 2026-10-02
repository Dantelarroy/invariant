import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
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

/**
 * One document to extract. Without `invoice` it is unlabeled: the run checks
 * its rules but scores no fields. `source` names where it came from.
 */
export type DocumentItem = {
  id: string;
  invoice?: Invoice;
  path: string;
  mediaType: string;
  source?: string;
};

/** One labeled document: the label's invoice plus where its file is. */
export type DatasetItem = DocumentItem & { invoice: Invoice };

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

  assertFilesExist(items);
  return items;
}

/**
 * Reads a sources manifest (`sources.jsonl`: one `{ file, source, use }`
 * per line, files next to it) and keeps the documents of one `use`, in
 * order and without labels. The media type comes from each file's extension.
 * Like loadDataset, it applies the limit first and fails before any model is
 * called when a selected file is missing.
 */
export function loadSources(
  manifestPath: string,
  options: { use: string; limit?: number },
): DocumentItem[] {
  const dir = dirname(manifestPath);
  const entries = readFileSync(manifestPath, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line, i) => {
      const entry = JSON.parse(line) as {
        file?: unknown;
        source?: unknown;
        use?: unknown;
      };
      if (typeof entry.file !== "string")
        throw new Error(`${basename(manifestPath)} line ${i + 1} has no file.`);
      return entry as { file: string; source?: unknown; use?: unknown };
    })
    .filter((entry) => entry.use === options.use);
  if (entries.length === 0)
    throw new Error(
      `No documents with use "${options.use}" in ${manifestPath}.`,
    );
  const selected =
    options.limit === undefined ? entries : entries.slice(0, options.limit);

  const items = selected.map((entry): DocumentItem => {
    const extension = extname(entry.file);
    const format = extension.slice(1).toLowerCase();
    if (!(format in MEDIA_TYPES))
      throw new Error(`Unsupported document format: ${entry.file}`);
    return {
      id: basename(entry.file, extension),
      path: join(dir, entry.file),
      mediaType: MEDIA_TYPES[format as DocumentFormat],
      ...(typeof entry.source === "string" ? { source: entry.source } : {}),
    };
  });

  assertFilesExist(items);
  return items;
}

function assertFilesExist(items: readonly DocumentItem[]): void {
  const missing = items.filter((item) => !existsSync(item.path));
  if (missing.length > 0)
    throw new Error(
      `Missing document files: ${missing.map((item) => item.path).join(", ")}`,
    );
}
