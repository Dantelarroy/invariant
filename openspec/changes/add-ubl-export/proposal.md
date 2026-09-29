# Proposal: add-ubl-export

## Why

Spain's B2B e-invoicing mandate (RD 238/2026) will require structured e-invoices. The end product of Invariant is therefore not a database row but an EN16931 e-invoice that validates. Today an accepted invoice stops at the ledger. Day 10 closes that gap for invoices that are already correct. The repair loop for incorrect ones is a separate change (`add-rule-guided-repair`).

## What Changes

- **UBL generation:** a new `@invariant/ubl` package maps a canonical `Invoice` to a UBL 2.1 invoice that follows EN16931. Where our contract has no field, deterministic mappings apply:
  - seller and buyer country `ES`, derived from a valid Spanish tax id;
  - `ES` + NIF as the VAT identifier;
  - the VAT breakdown grouped by rate;
  - unit code `C62`;
  - type code `380`.
- **Refusal instead of invention:** no UBL is produced when the data needed for a B2B e-invoice is missing or invalid (no buyer tax id, or an invalid tax id for either party). The result names the reason.
- **IRPF withholding:** mapped to UBL `WithholdingTaxTotal`. The payable amount stays the gross total, as EN16931 defines it. The validator reports this as a warning (UBL-CR-513), not an error.
- **EN16931 validation:** the official CEN schematron runs locally through the `easybill/en16931-validator` Docker service (pinned 0.7.0). Results come back as violation-shaped items (rule id, severity, message).
- **Dataset check:** a command, `pnpm ubl:check --dataset data/synth-erp --limit N`, generates and validates UBL for labeled invoices and reports how many are valid, refused or rejected, grouped by EN16931 rule. This proves the day 10 criterion: correct synthetic invoices produce valid UBL.
- **CI:** runs the validator as a service container, so the UBL integration tests run on every PR.

## Non-goals

- Wiring UBL into the mastra workflow or storing the XML in Postgres. That comes after repair.
- Repair, re-prompting and questions to the reviewer (`add-rule-guided-repair`).
- Extracting addresses, countries or units of measure, and any schema or prompt change.
- Credit notes and corrective invoices (rectificativas), and Facturae / Verifactu formats.
- XSD validation of the UBL. The validator checks the schematron only; structure is covered by our own tests.
- Changing ADR-0005: `@invariant/rules` stays pure. EN16931 validation lives in `@invariant/ubl`, because it needs I/O.

## Capabilities

### New Capabilities
- `ubl-export`: generating an EN16931 UBL invoice from a canonical invoice, refusing when required data is missing, and validating it against the EN16931 rules.

### Modified Capabilities
- None.

## Impact

- **Code:** new `packages/ubl` (mapper, validator client, dataset check CLI); root `package.json` script `ubl:check`.
- **Dependencies:** `xmlbuilder2` (MIT) to build the XML with guaranteed escaping and element order.
- **Infra:**
  - a `validator` service in the root `docker-compose.yml` on `127.0.0.1:8082`, because 8081 is taken by FacturaScripts;
  - a service container in `.github/workflows/ci.yml`.
- **ADRs:** relies on ADR-0001, ADR-0005 and ADR-0007. Adds ADR-0009, on the UBL mapping decisions (derived country, VAT id, IRPF, 0 % VAT, rounding, refusal).
