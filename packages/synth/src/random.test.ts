import { describe, expect, it } from "vitest";
import { createRandom } from "./random.js";

describe("createRandom", () => {
  it("returns the same sequence for the same seed", () => {
    const a = createRandom(42);
    const b = createRandom(42);
    expect([a.next(), a.next(), a.next()]).toEqual([
      b.next(),
      b.next(),
      b.next(),
    ]);
  });

  it("returns different sequences for different seeds", () => {
    expect(createRandom(1).next()).not.toBe(createRandom(2).next());
  });

  it("draws integers within inclusive bounds", () => {
    const random = createRandom(7);
    const draws = Array.from({ length: 1000 }, () => random.int(1, 3));
    expect(new Set(draws)).toEqual(new Set([1, 2, 3]));
  });
});
