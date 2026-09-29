import { beforeAll, describe, expect, it } from "vitest";
import { withIrpf } from "./test-fixtures.js";
import { toUbl } from "./to-ubl.js";
import { validateUbl } from "./validate.js";

const validatorUrl = process.env.EN16931_VALIDATOR_URL;

function ublOf(result: ReturnType<typeof toUbl>): string {
  if (result.kind !== "ubl") throw new Error("expected UBL");
  return result.xml;
}

describe.skipIf(!validatorUrl)("validateUbl (integration)", () => {
  const url = validatorUrl as string;

  // The validator compiles the schematron on start, so wait until it is healthy.
  beforeAll(async () => {
    for (let attempt = 0; attempt < 30; attempt++) {
      const healthy = await fetch(`${url}/health`)
        .then((r) => r.ok)
        .catch(() => false);
      if (healthy) return;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error(`EN16931 validator at ${url} is not healthy`);
  }, 40_000);

  it("accepts the UBL of a correct synthetic invoice, warning only about IRPF", async () => {
    const result = await validateUbl(ublOf(toUbl(withIrpf)), { url });
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
    expect(result.warnings.map((w) => w.ruleId)).toEqual(["UBL-CR-513"]);
  });

  it("rejects a UBL whose totals do not match its lines, naming the BR-CO rules", async () => {
    const tampered = ublOf(toUbl(withIrpf)).replace(
      '<cbc:PayableAmount currencyID="EUR">2132.47<',
      '<cbc:PayableAmount currencyID="EUR">2132.48<',
    );
    const result = await validateUbl(tampered, { url });
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.ruleId)).toContain("BR-CO-16");
  });
});
