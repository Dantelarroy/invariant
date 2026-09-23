/**
 * Formats an amount in integer cents as euros using Spanish conventions.
 *
 * Money in Invariant always travels as integer cents (never floats),
 * because 0.1 + 0.2 !== 0.3 in JavaScript.
 *
 * @example formatMoney(123456) // "1.234,56 €"
 */
export function formatMoney(cents: number): string {
  if (!Number.isSafeInteger(cents)) {
    throw new TypeError(
      `formatMoney expects integer cents, received: ${cents}`,
    );
  }

  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  const euros = Math.floor(absolute / 100);
  const remainder = absolute % 100;

  const eurosWithThousands = euros
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const centsTwoDigits = remainder.toString().padStart(2, "0");

  return `${sign}${eurosWithThousands},${centsTwoDigits} €`;
}
