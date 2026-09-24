import type { Random } from "./random.js";

const DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";

function digits(random: Random, count: number): string {
  return Array.from({ length: count }, () => random.int(0, 9)).join("");
}

/** A valid NIF of a person (DNI number + check letter), e.g. a self-employed supplier. */
export function randomNif(random: Random): string {
  const number = digits(random, 8);
  return `${number}${DNI_LETTERS[Number(number) % 23]}`;
}

/** A valid CIF of a limited company (S.L. → "B", S.A. → "A") with its check digit. */
export function randomCif(random: Random, entity: "A" | "B" = "B"): string {
  const body = digits(random, 7);
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const n = Number(body[i]);
    sum += i % 2 === 0 ? Math.floor((2 * n) / 10) + ((2 * n) % 10) : n;
  }
  return `${entity}${body}${(10 - (sum % 10)) % 10}`;
}
