import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Invoice } from "@invariant/schema";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadDataset } from "./dataset.js";

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
