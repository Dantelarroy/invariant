/** One EN16931 rule the document breaks or should look at. */
export type Finding = { ruleId: string; severity: string; message: string };

export type ValidationResult = {
  valid: boolean;
  errors: Finding[];
  warnings: Finding[];
};

/** What easybill/en16931-validator 0.7.0 answers for a parsed document. */
type ValidatorItem = {
  rule_id?: unknown;
  rule_severity?: unknown;
  rule_messages?: unknown;
};
type ValidatorBody = {
  is_valid?: unknown;
  errors?: unknown;
  warnings?: unknown;
};

export const DEFAULT_VALIDATOR_URL = "http://127.0.0.1:8082";

/**
 * Validates a UBL document against the EN16931 schematron through the
 * validator service. Fails loudly (never "valid") when the service is
 * unreachable, cannot parse the document or answers unexpectedly.
 */
export async function validateUbl(
  xml: string,
  options: { url: string; fetch?: typeof fetch },
): Promise<ValidationResult> {
  const endpoint = `${options.url.replace(/\/+$/, "")}/validation`;
  const fail = (why: string) =>
    new Error(`EN16931 validator at ${endpoint}: ${why}`);
  const doFetch = options.fetch ?? fetch;

  let response: Response;
  try {
    response = await doFetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/xml" },
      body: xml,
    });
  } catch (error) {
    throw fail(error instanceof Error ? error.message : String(error));
  }
  // The validator answers 200 for valid and invalid documents alike; 400 is accepted too.
  if (response.status === 422)
    throw fail("the document could not be parsed (422)");
  if (response.status !== 200 && response.status !== 400)
    throw fail(`unexpected status ${response.status}`);

  let body: ValidatorBody;
  try {
    body = (await response.json()) as ValidatorBody;
  } catch {
    throw fail("the answer is not JSON");
  }
  if (
    typeof body !== "object" ||
    body === null ||
    typeof body.is_valid !== "boolean" ||
    !Array.isArray(body.errors) ||
    !Array.isArray(body.warnings)
  )
    throw fail("the answer has no is_valid, errors and warnings");

  const toFinding = (item: ValidatorItem): Finding => {
    if (typeof item?.rule_id !== "string" || item.rule_id === "")
      throw fail("an item has no rule_id");
    const messages = Array.isArray(item.rule_messages)
      ? item.rule_messages.map(String)
      : [];
    return {
      ruleId: item.rule_id,
      severity: String(item.rule_severity ?? "").toLowerCase(),
      // Messages repeat the rule id as a "[BR-CO-15]-" prefix.
      message: messages
        .map((m) => m.replace(`[${item.rule_id}]-`, ""))
        .join(" "),
    };
  };
  const errors = (body.errors as ValidatorItem[]).map(toFinding);
  const warnings = (body.warnings as ValidatorItem[]).map(toFinding);
  if (body.is_valid && errors.length > 0)
    throw fail("the answer says valid but lists errors");
  return { valid: body.is_valid, errors, warnings };
}
