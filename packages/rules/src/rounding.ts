/**
 * Rounds `cents × basisPoints / 10000` to whole cents, half away from zero,
 * using integer arithmetic only (no floating-point surprises).
 *
 * @example applyRate(15, 2100) // 0,15 € at 21 % = 0,0315 € → 3 cents
 */
export function applyRate(cents: number, basisPoints: number): number {
  const product = cents * basisPoints;
  const sign = product < 0 ? -1 : 1;
  return sign * Math.floor((Math.abs(product) + 5000) / 10000);
}
