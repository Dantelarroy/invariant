# Spec Delta

## Purpose

Measure how well an extractor reads invoices by comparing its output with labeled invoices, field by field, and produce reproducible reports to compare models and prompts.

## ADDED Requirements

### Requirement: Field-level scoring against a label
The system SHALL compare an extracted invoice with its label, and report for each scored field whether it matches. Scored fields: invoice number, issue date, supplier tax id, customer tax id, tax base, VAT amount, withholding, total, and the number of lines. Amounts SHALL match exactly in cents. Tax ids and invoice numbers SHALL be compared ignoring case, spaces, dots and hyphens. A field absent in both the label and the extraction counts as a match.

#### Scenario: Perfect extraction
- **WHEN** an extraction equal to its label is scored
- **THEN** every scored field matches and the document is an exact match

#### Scenario: One amount off by one cent
- **WHEN** the extraction's total differs from the label by 1 cent and every other field matches
- **THEN** only the total is reported as a mismatch, with the expected and actual values
- **AND** the document is not an exact match

#### Scenario: Formatting differences in identifiers
- **WHEN** the label's supplier tax id is `B12345674` and the extraction has `b-12345674`
- **THEN** the supplier tax id counts as a match

#### Scenario: Withholding missing from the extraction
- **WHEN** the label has a withholding and the extraction has none
- **THEN** the withholding is reported as a mismatch

### Requirement: Rule verdict alongside accuracy
For every scored document, the system SHALL also report whether the extracted invoice passes the business rules, with the ids of the rules that failed. This is independent of the label, so rule pass rate can be compared with real accuracy.

#### Scenario: Wrong but consistent extraction
- **WHEN** an extraction misreads the total and the tax base consistently, so the rules pass
- **THEN** the document reports the mismatched fields and a passing rule verdict

### Requirement: Run a model over a labeled dataset
The system SHALL provide a command that takes a dataset directory (a `labels.jsonl` plus the documents it names), a model id and an optional limit. It SHALL extract each document in a stable order and print a summary with:
- the number of documents;
- per-field accuracy;
- the exact-match rate and the rule pass rate;
- the number of failed extractions;
- the total input and output tokens;
- the median latency.

It SHALL write a JSON report with the per-document results to `data/evals/`, named after the dataset, model and time.

#### Scenario: Run on the first 20 FacturaScripts invoices
- **WHEN** the command runs with the FacturaScripts dataset, model `gpt-5-mini` and limit 20
- **THEN** exactly the first 20 labeled documents are extracted
- **AND** a summary is printed and a JSON report is written under `data/evals/`

#### Scenario: One document fails to extract
- **WHEN** one document's extraction throws an error
- **THEN** the run continues with the next document
- **AND** the report counts it as a failed extraction with its error message, and it scores as a mismatch on every field

#### Scenario: Label points to a missing file
- **WHEN** a label names a document that does not exist in the dataset directory
- **THEN** the command stops before calling any model and names the missing file

### Requirement: Reproducible, private reports
Reports SHALL record the dataset path, model id, prompt version, limit and start time, so a run can be repeated and compared. Reports and datasets SHALL stay under `data/`, which is never committed.

#### Scenario: Report metadata
- **WHEN** a run finishes
- **THEN** its report contains the dataset, model id, prompt version, limit and start time
