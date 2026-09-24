import { describe, expect, it } from "vitest";
import { validateSpanishTaxId } from "./tax-id.js";

describe("validateSpanishTaxId", () => {
  it.each([
    ["12345678Z", "nif"], // DNI: 12345678 mod 23 = 14 → Z
    ["X1234567L", "nie"], // NIE: X → 0, then like a DNI
    ["Y1234567X", "nie"],
    ["B12345674", "cif"], // company: control digit 4
    ["A58818501", "cif"],
    ["Q2826000H", "cif"], // public body: control must be a letter
  ])("accepts %s as a valid %s", (id, kind) => {
    expect(validateSpanishTaxId(id)).toEqual({
      valid: true,
      kind,
      normalized: id,
    });
  });

  it("normalizes spaces, dashes, dots, lowercase and the ES VAT prefix", () => {
    expect(validateSpanishTaxId("es b-12.345.674")).toEqual({
      valid: true,
      kind: "cif",
      normalized: "B12345674",
    });
  });

  it.each([
    ["12345678A", "wrong DNI letter"],
    ["X1234567A", "wrong NIE letter"],
    ["B12345678", "wrong CIF control digit"],
    ["Q2826000A", "wrong CIF control letter"],
    ["B1234567", "too short"],
    ["", "empty"],
    ["hello", "not an id"],
  ])("rejects %s (%s)", (id) => {
    expect(validateSpanishTaxId(id).valid).toBe(false);
  });

  it("does not judge foreign VAT numbers", () => {
    expect(validateSpanishTaxId("DE123456789")).toEqual({
      valid: true,
      kind: "foreign",
      normalized: "DE123456789",
    });
  });
});
