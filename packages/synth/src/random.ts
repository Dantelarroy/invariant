export type Random = {
  /** A float in [0, 1). */
  next: () => number;
  /** An integer in [min, max], both inclusive. */
  int: (min: number, max: number) => number;
  pick: <T>(items: readonly T[]) => T;
  chance: (probability: number) => boolean;
};

/**
 * Seeded pseudo-random numbers (mulberry32). The same seed always yields the
 * same sequence, so every synthetic document can be regenerated exactly.
 */
export function createRandom(seed: number): Random {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) =>
    min + Math.floor(next() * (max - min + 1));
  return {
    next,
    int,
    pick: (items) => {
      if (items.length === 0) throw new Error("pick() needs at least one item");
      return items[int(0, items.length - 1)] as (typeof items)[number];
    },
    chance: (probability) => next() < probability,
  };
}
