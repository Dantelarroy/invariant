import { describe, expect, it } from "vitest";
import { formatMoney } from "./money.js";

describe("formatMoney", () => {
  it("formats zero", () => {
    expect(formatMoney(0)).toBe("0,00 €");
  });

  it("pads cents to two digits", () => {
    expect(formatMoney(5)).toBe("0,05 €");
  });

  it("uses a dot for thousands and a comma for decimals", () => {
    expect(formatMoney(123456)).toBe("1.234,56 €");
    expect(formatMoney(1000000)).toBe("10.000,00 €");
  });

  it("formats negative amounts (credit notes)", () => {
    expect(formatMoney(-1500)).toBe("-15,00 €");
  });

  it("rejects values that are not integer cents", () => {
    expect(() => formatMoney(1.5)).toThrow();
    expect(() => formatMoney(Number.NaN)).toThrow();
    expect(() => formatMoney(Number.POSITIVE_INFINITY)).toThrow();
  });
});
