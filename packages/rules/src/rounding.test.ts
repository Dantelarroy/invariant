import { describe, expect, it } from "vitest";
import { applyRate } from "./rounding.js";

describe("applyRate", () => {
  it("rounds half away from zero to whole cents", () => {
    expect(applyRate(6000, 1000)).toBe(600); // 60,00 € at 10 % = 6,00 €
    expect(applyRate(300, 400)).toBe(12); // 3,00 € at 4 % = 0,12 €
    expect(applyRate(50, 2100)).toBe(11); // 0,105 € → 0,11 €
    expect(applyRate(15, 2100)).toBe(3); // 0,0315 € → 0,03 €
  });

  it("is symmetric for negative amounts (credit notes)", () => {
    expect(applyRate(-50, 2100)).toBe(-11);
  });
});
