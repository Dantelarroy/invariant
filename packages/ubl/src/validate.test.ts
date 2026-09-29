import { describe, expect, it } from "vitest";
import { validateUbl } from "./validate.js";

const VALIDATOR_URL = "http://validator.test:8082";

const bcoItem = {
  rule_id: "BR-CO-15",
  rule_location: "/*:Invoice[1]",
  rule_severity: "FATAL",
  rule_messages: [
    "[BR-CO-15]-Invoice total amount with VAT (BT-112) = Invoice total amount without VAT (BT-109) + Invoice total VAT amount (BT-110).",
  ],
};
const withholdingItem = {
  rule_id: "UBL-CR-513",
  rule_location: "/*:Invoice[1]",
  rule_severity: "WARNING",
  rule_messages: [
    "[UBL-CR-513]-A UBL invoice should not include the WithholdingTaxTotal",
  ],
};
const meta = {
  validation_profile: "UBL",
  validation_profile_version: "1.3.16",
};

/** A fake fetch that records its request and answers with this status and body. */
function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(
      typeof body === "string" ? body : JSON.stringify(body),
      { status, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  return { fn, calls };
}

describe("validateUbl", () => {
  it("posts the XML to /validation and maps a valid answer with its warnings", async () => {
    const { fn, calls } = fakeFetch(200, {
      meta,
      errors: [],
      warnings: [withholdingItem],
      is_valid: true,
    });
    const result = await validateUbl("<Invoice/>", {
      url: `${VALIDATOR_URL}/`,
      fetch: fn,
    });
    expect(result).toEqual({
      valid: true,
      errors: [],
      warnings: [
        {
          ruleId: "UBL-CR-513",
          severity: "warning",
          message: "A UBL invoice should not include the WithholdingTaxTotal",
        },
      ],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${VALIDATOR_URL}/validation`);
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.body).toBe("<Invoice/>");
    expect(new Headers(calls[0]?.init?.headers).get("content-type")).toBe(
      "application/xml",
    );
  });

  it.each([200, 400])("maps rule errors from a %i answer", async (status) => {
    const { fn } = fakeFetch(status, {
      meta,
      errors: [bcoItem],
      warnings: [],
      is_valid: false,
    });
    const result = await validateUbl("<Invoice/>", {
      url: VALIDATOR_URL,
      fetch: fn,
    });
    expect(result).toEqual({
      valid: false,
      errors: [
        {
          ruleId: "BR-CO-15",
          severity: "fatal",
          message:
            "Invoice total amount with VAT (BT-112) = Invoice total amount without VAT (BT-109) + Invoice total VAT amount (BT-110).",
        },
      ],
      warnings: [],
    });
  });

  it("never reports valid when the answer lists errors", async () => {
    const { fn } = fakeFetch(200, {
      errors: [bcoItem],
      warnings: [],
      is_valid: true,
    });
    await expect(
      validateUbl("<Invoice/>", { url: VALIDATOR_URL, fetch: fn }),
    ).rejects.toThrow(VALIDATOR_URL);
  });

  it.each([
    ["an unparsable document (422)", 422, ""],
    ["a server error (500)", 500, "boom"],
    ["a body that is not JSON", 200, "<html>proxy</html>"],
    ["a JSON body without the expected fields", 200, { valid: true }],
    [
      "an item without a rule id",
      400,
      { errors: [{}], warnings: [], is_valid: false },
    ],
  ])("throws with the VALIDATOR_URL on %s", async (_, status, body) => {
    const { fn } = fakeFetch(status, body);
    await expect(
      validateUbl("<Invoice/>", { url: VALIDATOR_URL, fetch: fn }),
    ).rejects.toThrow(VALIDATOR_URL);
  });

  it("throws with the VALIDATOR_URL when the validator cannot be reached", async () => {
    const fn = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await expect(
      validateUbl("<Invoice/>", { url: VALIDATOR_URL, fetch: fn }),
    ).rejects.toThrow(/validator\.test:8082.*fetch failed/);
  });
});
