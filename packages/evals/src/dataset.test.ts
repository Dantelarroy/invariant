import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Invoice } from "@invariant/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadDataset, loadSources } from "./dataset.js";

const invoice: Invoice = {
  number: "F-1",
  issueDate: "2026-09-24",
  currency: "EUR",
  supplier: { name: "Proveedor SL", taxId: "B12345674" },
  customer: { name: "Cliente SL" },
  lines: [
    {
      description: "Item",
      quantity: 1,
      unitPriceCents: 1000,
      lineTotalCents: 1000,
      vatRateBps: 2100,
    },
  ],
  taxBaseCents: 1000,
  vatAmountCents: 210,
  totalCents: 1210,
};

let dir: string;

/** Writes labels.jsonl (in the given order) and one empty file per name. */
function writeDataset(ids: string[], files: string[]) {
  const labels = ids.map((id) =>
    JSON.stringify({ id, invoice: { ...invoice, number: id } }),
  );
  writeFileSync(join(dir, "labels.jsonl"), `${labels.join("\n")}\n`);
  for (const file of files) writeFileSync(join(dir, file), "x");
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "invariant-evals-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("loadDataset", () => {
  it("keeps the order of labels.jsonl and maps each id to <id>.<format>", () => {
    writeDataset(["c", "a", "b"], ["a.pdf", "b.pdf", "c.pdf"]);

    const items = loadDataset(dir, { format: "pdf" });

    expect(items.map((item) => item.id)).toEqual(["c", "a", "b"]);
    expect(items[0]).toEqual({
      id: "c",
      invoice: { ...invoice, number: "c" },
      path: join(dir, "c.pdf"),
      mediaType: "application/pdf",
    });
  });

  it("applies the limit to the first labels only", () => {
    writeDataset(["c", "a", "b"], ["a.pdf", "b.pdf", "c.pdf"]);

    const items = loadDataset(dir, { format: "pdf", limit: 2 });

    expect(items.map((item) => item.id)).toEqual(["c", "a"]);
  });

  it("infers the media type from the format", () => {
    writeDataset(["a"], ["a.jpg"]);

    const [item] = loadDataset(dir, { format: "jpg" });

    expect(item?.path).toBe(join(dir, "a.jpg"));
    expect(item?.mediaType).toBe("image/jpeg");
  });

  it("throws before anything runs when a label names a missing file, naming that file", () => {
    writeDataset(["a", "b"], ["a.pdf"]);

    expect(() => loadDataset(dir, { format: "pdf" })).toThrow(/b\.pdf/);
  });

  it("rejects a label whose invoice does not match the schema", () => {
    writeFileSync(
      join(dir, "labels.jsonl"),
      `${JSON.stringify({ id: "a", invoice: { totalCents: 1.5 } })}\n`,
    );
    writeFileSync(join(dir, "a.pdf"), "x");

    expect(() => loadDataset(dir, { format: "pdf" })).toThrow(/a/);
  });
});

describe("loadSources", () => {
  /** Writes sources.jsonl (in the given order) and one empty file per name. */
  function writeSources(
    entries: { file: string; source: string; use: string }[],
    files: string[],
  ) {
    const lines = entries.map((entry) =>
      JSON.stringify({ ...entry, url: "https://example.com", notes: "" }),
    );
    writeFileSync(join(dir, "sources.jsonl"), `${lines.join("\n")}\n`);
    for (const file of files) writeFileSync(join(dir, file), "x");
  }

  it("keeps the documents of one use, in order, without labels", () => {
    writeSources(
      [
        { file: "b--two.png", source: "billeo", use: "eval" },
        { file: "d--blank.png", source: "declarando", use: "discard" },
        { file: "q--one.pdf", source: "quipu", use: "eval" },
      ],
      ["b--two.png", "d--blank.png", "q--one.pdf"],
    );

    const items = loadSources(join(dir, "sources.jsonl"), { use: "eval" });

    expect(items).toEqual([
      {
        id: "b--two",
        path: join(dir, "b--two.png"),
        mediaType: "image/png",
        source: "billeo",
      },
      {
        id: "q--one",
        path: join(dir, "q--one.pdf"),
        mediaType: "application/pdf",
        source: "quipu",
      },
    ]);
    expect(items[0]).not.toHaveProperty("invoice");
  });

  it("infers the media type from each file's extension and applies the limit", () => {
    writeSources(
      [
        { file: "w--a.JPG", source: "wikimedia", use: "eval" },
        { file: "b--b.webp", source: "billeo", use: "eval" },
        { file: "b--c.png", source: "billeo", use: "eval" },
      ],
      ["w--a.JPG", "b--b.webp"],
    );

    const items = loadSources(join(dir, "sources.jsonl"), {
      use: "eval",
      limit: 2,
    });

    expect(items.map((item) => item.mediaType)).toEqual([
      "image/jpeg",
      "image/webp",
    ]);
  });

  it("throws before anything runs when a selected file is missing, naming it", () => {
    writeSources(
      [
        { file: "a.png", source: "x", use: "eval" },
        { file: "b.png", source: "x", use: "eval" },
      ],
      ["a.png"],
    );

    expect(() =>
      loadSources(join(dir, "sources.jsonl"), { use: "eval" }),
    ).toThrow(/b\.png/);
  });

  it("rejects a file whose extension has no media type", () => {
    writeSources([{ file: "a.docx", source: "x", use: "eval" }], ["a.docx"]);

    expect(() =>
      loadSources(join(dir, "sources.jsonl"), { use: "eval" }),
    ).toThrow(/a\.docx/);
  });

  it("rejects a use that selects no document", () => {
    writeSources([{ file: "a.png", source: "x", use: "eval" }], ["a.png"]);

    expect(() =>
      loadSources(join(dir, "sources.jsonl"), { use: "train" }),
    ).toThrow(/train/);
  });
});
