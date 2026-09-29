# Design

## Context

- The canonical `Invoice` (`packages/schema/src/invoice.ts`) has party names and optional tax ids, lines (description, quantity, unit price, line total, VAT rate in basis points), tax base, VAT amount, optional withholding and total. It has no addresses, countries, units, due dates or payment means.
- `@invariant/rules` is pure and synchronous (ADR-0005). `validateSpanishTaxId` (`packages/rules/src/tax-id.ts`) and `applyRate` (`packages/rules/src/rounding.ts`) can be reused.
- `easybill/en16931-validator:0.7.0` is MIT, runs on amd64 and arm64, and needs no JVM on the host.
  - It listens on port 8080: `POST /validation` with `Content-Type: application/xml`, and `GET /health`.
  - It answers 200 (valid), 400 (invalid) or 422 (unparsable), with the JSON body `{ is_valid, errors[], warnings[] }`. Each item is `{ rule_id, rule_location, rule_severity, rule_messages[] }`.
  - It checks the CEN EN16931 schematron 1.3.16 only, with no XSD.
- Plain EN16931 1.3.16 does not require payment means, due date or payment terms. BR-CO-25 belongs to CIUSes such as Peppol, not to the core.

## Goals / Non-Goals

**Goals:**
- A pure mapper, `toUbl(invoice)`, that returns `{ kind: "ubl", xml }` or `{ kind: "refused", reasons }`. It is fully unit-tested without Docker.
- A thin validator client, tested with a fake `fetch`. Integration tests run against the real service and are skipped when the service URL is unset, following the `describe.skipIf(!databaseUrl)` pattern.
- Evidence on real-software invoices: the dataset check on `data/synth-erp`.

**Non-Goals:**
- Making every FacturaScripts invoice valid by adjusting printed numbers (see decision 5).

## Decisions

1. **XML built with `xmlbuilder2`.** It is namespace-aware, escapes by construction and keeps element order explicit. Order matters because the validator does not run the XSD.
   - *Alternative:* template strings, where escaping and order would be on us.
   - *Alternative:* the `fast-xml-parser` builder, where order follows object keys and namespaces are only a convention.
2. **Refusal is a value, not an exception.** A missing or invalid tax id is expected business input (tickets, private customers), so the mapper returns `refused` with its reasons. Exceptions are kept for programming errors.
3. **Derived fields and their justification (ADR-0009):**
   - Country `ES`: a valid Spanish NIF, NIE or CIF implies a Spanish party.
   - VAT id `ES` + NIF: a seller charging Spanish VAT holds a NIF-IVA, whose EN16931 form is the country prefix plus the NIF.
   - Legal registration id (BT-30): the bare NIF.
   - Unit `C62` ("one"): an explicit "unspecified" unit. It is known to be imprecise for goods sold by weight.
   - Category `S` for rates above 0 and `Z` for 0 %. `E` (exempt) would need an exemption reason we do not capture.
   - Type code `380`.
4. **VAT breakdown by rate.** Group lines by `vatRateBps`. The taxable amount is the sum of the line totals at that rate, and the tax is `applyRate` of that amount.
   - BR-CO-14 requires the document VAT total to equal the sum of the breakdown taxes exactly.
   - The `vat-amount` rule tolerates a one-cent difference. When the printed VAT differs from the breakdown sum by that cent, the difference goes to the breakdown with the largest taxable amount. That keeps the printed total and satisfies BR-CO-14.
   - This adjustment is recorded in ADR-0009.
5. **Totals copy the printed values.** BT-106 = sum of line totals, BT-109 = printed tax base, BT-110 = printed VAT, BT-112 = base + VAT, BT-115 = BT-112.
   - Real programs can print lines whose sum differs from their base by rounding cents (ADR-0005, ADR-0007). BR-CO-10 and BR-CO-13 then fail.
   - We report that honestly instead of rewriting printed numbers. The dataset check measures how often it happens.
   - A later decision (a rounding line, or regenerated labels) can then be made with that evidence.
6. **IRPF as `cac:WithholdingTaxTotal`,** placed after `cac:TaxTotal` with scheme `IRPF`, following the OASIS guidance for Spanish IRPF. EN16931 treats it as a warning (UBL-CR-513), and its totals remain gross.
7. **Validator client.** `validateUbl(xml, { url, fetch? })` maps 200 and 400 to `{ valid, errors, warnings }`, with items `{ ruleId, severity, message }`.
   - It throws on 422, on any other status, on a malformed body and on network errors. The message includes the URL.
   - The URL comes from `EN16931_VALIDATOR_URL`, default `http://127.0.0.1:8082`.
8. **Infra.**
   - The root `docker-compose.yml` gains a `validator` service: `easybill/en16931-validator:0.7.0` on `127.0.0.1:8082:8080`, with a healthcheck on `/health`.
   - CI adds it as a service container mapped to 8082, with `wget` on `/health` as the health command, and sets `EN16931_VALIDATOR_URL`.
9. **Dataset check CLI (`packages/ubl/src/cli/check-dataset.ts`).**
   - It reads `labels.jsonl` through the `loadDataset` function of `@invariant/evals`, which only needs the labels.
   - It exports and validates one document at a time, prints the counts and the failures per rule, and exits non-zero on any invalid document.

## Risks / Trade-offs

- **No XSD validation:** an out-of-order element could pass the schematron. → Mitigation: the mapper test snapshots the element order of a full invoice, and xmlbuilder2 writes elements in call order.
- **Rounding cents on real-software invoices** make some documents invalid. → Mitigation: measure and report per rule, then decide with evidence (decision 5).
- **Validator startup** takes seconds while it compiles the schematron. → Mitigation: the healthcheck, plus a retry in the integration test setup.
- **Warning noise:** UBL-CR-513 appears on every withholding invoice. → Mitigation: the dataset check reports warnings separately, and only errors decide validity.

## Migration Plan

Additive only: a new package, a new service and a new CI service container. Rollback means reverting the PR.

## Open Questions

- Whether to extract real addresses and units later. That is a schema and prompt change, and it can be decided once the real benchmark exists.
