import { validateSpanishTaxId } from "@invariant/rules";
import { describe, expect, it } from "vitest";
import { createRandom } from "./random.js";
import { randomCif, randomNif } from "./tax-ids.js";

describe("synthetic tax ids", () => {
  // Checked against the independent validator in @invariant/rules.
  it("generates CIFs that pass the official check", () => {
    const random = createRandom(1);
    for (let i = 0; i < 1000; i++) {
      expect(validateSpanishTaxId(randomCif(random))).toMatchObject({
        valid: true,
        kind: "cif",
      });
    }
  });

  it("generates NIFs that pass the official check", () => {
    const random = createRandom(2);
    for (let i = 0; i < 1000; i++) {
      expect(validateSpanishTaxId(randomNif(random))).toMatchObject({
        valid: true,
        kind: "nif",
      });
    }
  });
});
