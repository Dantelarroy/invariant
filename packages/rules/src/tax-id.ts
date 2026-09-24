export type TaxIdCheck =
  | { valid: true; kind: "nif" | "nie" | "cif" | "foreign"; normalized: string }
  | { valid: false; normalized: string; reason: string };

const DNI_LETTERS = "TRWAGMYFPDXBNJZSQVHLCKE";
const CIF_CONTROL_LETTERS = "JABCDEFGHI";
/** Entity types whose control character is always a letter / always a digit. */
const CIF_LETTER_CONTROL = new Set(["N", "P", "Q", "R", "S", "W"]);
const CIF_DIGIT_CONTROL = new Set(["A", "B", "E", "H"]);

function normalize(raw: string): string {
  const compact = raw.toUpperCase().replace(/[\s.\-/]/g, "");
  // "ES" + a Spanish id is the intra-EU VAT number; the id itself follows.
  return /^ES[0-9A-Z]\d{7}[0-9A-Z]$/.test(compact) ? compact.slice(2) : compact;
}

function dniLetter(digits: string): string {
  return DNI_LETTERS[Number(digits) % 23] as string;
}

function cifControlDigit(digits: string): number {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    const n = Number(digits[i]);
    // Positions 1, 3, 5, 7 (even index) are doubled and their digits added.
    sum += i % 2 === 0 ? Math.floor((2 * n) / 10) + ((2 * n) % 10) : n;
  }
  return (10 - (sum % 10)) % 10;
}

/**
 * Validates a Spanish tax id (NIF of a person, NIE of a foreign resident,
 * or CIF of a company) with its official check character.
 * Foreign EU VAT numbers are accepted as-is: we cannot verify them offline.
 */
export function validateSpanishTaxId(raw: string): TaxIdCheck {
  const id = normalize(raw);
  const invalid = (reason: string): TaxIdCheck => ({
    valid: false,
    normalized: id,
    reason,
  });

  let match = /^(\d{8})([A-Z])$/.exec(id);
  if (match) {
    const [, digits = "", letter] = match;
    return letter === dniLetter(digits)
      ? { valid: true, kind: "nif", normalized: id }
      : invalid(`NIF letter should be ${dniLetter(digits)}`);
  }

  match = /^([XYZ])(\d{7})([A-Z])$/.exec(id);
  if (match) {
    const [, prefix = "X", digits = "", letter] = match;
    const expected = dniLetter(`${"XYZ".indexOf(prefix)}${digits}`);
    return letter === expected
      ? { valid: true, kind: "nie", normalized: id }
      : invalid(`NIE letter should be ${expected}`);
  }

  match = /^([ABCDEFGHJNPQRSUVW])(\d{7})([0-9A-J])$/.exec(id);
  if (match) {
    const [, entity = "", digits = "", control = ""] = match;
    const digit = cifControlDigit(digits);
    const letter = CIF_CONTROL_LETTERS[digit] as string;
    const ok = CIF_LETTER_CONTROL.has(entity)
      ? control === letter
      : CIF_DIGIT_CONTROL.has(entity)
        ? control === String(digit)
        : control === letter || control === String(digit);
    return ok
      ? { valid: true, kind: "cif", normalized: id }
      : invalid(
          `CIF control should be ${CIF_LETTER_CONTROL.has(entity) ? letter : digit}`,
        );
  }

  // EU VAT numbers: 2-letter country code followed by 2–13 characters, at least one a digit.
  if (
    /^[A-Z]{2}(?=[0-9A-Z]*\d)[0-9A-Z]{2,13}$/.test(id) &&
    !id.startsWith("ES")
  ) {
    return { valid: true, kind: "foreign", normalized: id };
  }
  return invalid("not a Spanish NIF, NIE or CIF");
}
