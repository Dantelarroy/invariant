# ubl-export Specification

## Purpose
Turn a correct canonical invoice into an EN16931 UBL 2.1 e-invoice, refuse when the data for a B2B e-invoice is missing, and check the result against the official EN16931 rules.

## Requirements

### Requirement: Generate a UBL invoice from a canonical invoice
The system SHALL produce a UBL 2.1 Invoice document declaring the EN16931 specification (`urn:cen.eu:en16931:2017`), type code 380 and currency EUR. The document SHALL carry the invoice number, issue date, seller and buyer names, one invoice line per canonical line (quantity, net price, net amount, item name, VAT category and rate), a VAT breakdown per rate, and the document totals. Amounts SHALL be written with two decimals, derived from integer cents without floating-point arithmetic.

#### Scenario: Correct invoice with two VAT rates
- **WHEN** a canonical invoice with lines at 21 % and 10 % is exported
- **THEN** the UBL has one line per canonical line and one VAT breakdown per rate
- **AND** each breakdown's taxable amount is the sum of its lines
- **AND** the document totals equal the invoice's tax base, VAT amount and total

#### Scenario: Amount formatting
- **WHEN** an amount of 123456 cents is exported
- **THEN** it is written as `1234.56` with currency EUR

### Requirement: Derive only what the tax ids justify
The system SHALL set the seller and buyer country to `ES`, and their VAT identifiers to `ES` followed by the tax id, only when that party's tax id is a valid Spanish NIF, NIE or CIF. Lines SHALL use unit code `C62`. A VAT rate above 0 SHALL map to category `S` and a rate of 0 to category `Z`. The system MUST NOT invent any other party data.

#### Scenario: Valid Spanish tax ids
- **WHEN** both parties have valid Spanish tax ids
- **THEN** both parties have country `ES` and VAT identifier `ES` + tax id

### Requirement: Refuse instead of inventing
The system MUST NOT produce UBL when the buyer has no tax id, or when either party's tax id is not a valid Spanish tax id. It SHALL return a refusal that names the reason and the party.

#### Scenario: Ticket to a private customer
- **WHEN** an invoice without a buyer tax id is exported
- **THEN** no UBL is produced
- **AND** the refusal says that the buyer tax id is required for a B2B e-invoice

#### Scenario: Invalid seller tax id
- **WHEN** the seller tax id fails its check character
- **THEN** no UBL is produced, and the refusal names the seller tax id

### Requirement: Represent IRPF withholding without breaking EN16931 totals
When the invoice has a withholding, the system SHALL include it as a withholding tax total with its amount. The EN16931 payable amount SHALL remain the tax-inclusive total (tax base plus VAT), so EN16931 totals stay consistent. The net amount after withholding is carried only by the withholding element.

#### Scenario: Invoice with IRPF
- **WHEN** an invoice with base 1762.37, VAT 370.10 and withholding 264.36 is exported
- **THEN** the UBL payable amount is 2132.47
- **AND** the UBL contains a withholding tax total of 264.36

### Requirement: Validate against the EN16931 rules
The system SHALL validate a UBL document with the EN16931 schematron through the configured validator service. It SHALL return whether the document is valid, plus its errors and warnings, each with rule id, severity and message. It MUST fail loudly, rather than report "valid", when the validator is unreachable or answers with an unexpected response.

#### Scenario: Valid document
- **WHEN** the UBL of a correct synthetic invoice is validated
- **THEN** the result is valid with no errors
- **AND** a withholding warning (UBL-CR-513) may be present

#### Scenario: Broken document
- **WHEN** a UBL whose totals do not match its lines is validated
- **THEN** the result is invalid, and the errors include the EN16931 rule ids that failed

#### Scenario: Validator down
- **WHEN** the validator service cannot be reached
- **THEN** validation fails with an error naming the validator URL

### Requirement: Check a labeled dataset end to end
The system SHALL provide a command that exports and validates the labeled invoices of a dataset, up to an optional limit. It SHALL print how many were valid, refused (with reasons) and invalid, plus a count of failures per EN16931 rule id. It SHALL exit with a non-zero status when any exported document is invalid.

#### Scenario: FacturaScripts dataset
- **WHEN** the command runs on `data/synth-erp` with limit 50
- **THEN** it prints the valid, refused and invalid counts and the failing rule ids
- **AND** its exit status is zero only if no exported document was invalid
