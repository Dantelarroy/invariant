# Spec Delta

## Purpose

Fix rule failures by asking the model once more with only the violated rules. When a person is still needed, ask them a concrete question built from the numbers behind the failure.

## ADDED Requirements

### Requirement: Violations carry the numbers behind them
Every error rule violation SHALL include structured details with the values the rule compared, in integer cents where they are amounts, alongside its existing message and path. The details are:
- **`lines-sum`:** lines sum and tax base.
- **`vat-amount`:** expected and printed VAT.
- **`total`:** tax base, VAT, withholding, expected and printed total.
- **`vat-rate`:** line number and rate.
- **`tax-ids`:** party, value (when present) and reason.
- **`issue-date`:** issue date and today.

Existing messages, severities and rule outcomes MUST NOT change.

#### Scenario: Wrong total
- **WHEN** an invoice with base 90.00, VAT 18.90, withholding 6.05 and printed total 112.85 is verified
- **THEN** the `total` violation's details hold base 9000, VAT 1890, withholding 605, expected 10285 and printed 11285

#### Scenario: Existing behavior preserved
- **WHEN** any invoice from the existing rule tests is verified
- **THEN** the violations have the same rule ids, severities, messages and paths as before

### Requirement: Repair once, with a clean and targeted prompt
When the verified extraction has at least one error, the system SHALL ask the model exactly once more. The request SHALL contain the original source (the same text or document) and the messages of the violated error rules only. It MUST NOT contain the previous model answer, the previous conversation or any warning. The repair SHALL use its own versioned prompt. It SHALL NOT run when there are no errors.

#### Scenario: No errors, no repair
- **WHEN** an extraction passes every error rule
- **THEN** the model is called once in total, and the run records no repair

#### Scenario: Repair request contents
- **WHEN** an extraction fails the `tax-ids` rule and has a `line-amount` warning
- **THEN** the second model call contains the original source and the `tax-ids` message
- **AND** it contains neither the `line-amount` warning nor the first answer

#### Scenario: Never a second repair
- **WHEN** the repaired extraction still has errors
- **THEN** the model is not called a third time

### Requirement: Choose the better extraction
After a repair, the system SHALL continue with the repaired extraction when it has no errors. Otherwise it SHALL continue with whichever extraction has fewer errors, keeping the original on a tie. The run SHALL record whether the repaired extraction was used, and the invoice SHALL keep the prompt version that produced it.

#### Scenario: Repair fixes the invoice
- **WHEN** the first extraction misreads the supplier tax id and the repaired one passes every rule
- **THEN** the invoice is accepted without a person, reviewed by rules
- **AND** the outcome says it was repaired, with prompt version `repair-v1`

#### Scenario: Repair makes it worse
- **WHEN** the first extraction has one error and the repaired one has two
- **THEN** the run continues with the first extraction and says it was not repaired

### Requirement: Ask a concrete question
When errors remain after repair, the review request SHALL include a question in Spanish built from the first error's details. Amounts SHALL be formatted as Spanish money (`1.234,56 €`). The question SHALL state the conflicting values and ask about the one printed on the document. Warnings on the same invoice SHALL be appended as context. The review request SHALL keep the list of issues.

#### Scenario: Wrong total question
- **WHEN** the remaining error is `total`, with printed 112,85 € and expected 102,85 €
- **THEN** the question is "El total impreso es 112,85 € pero base + IVA − retención da 102,85 €. ¿El total del documento es 112,85 €?"

#### Scenario: Lines do not add up, with a line warning
- **WHEN** the remaining error is `lines-sum` and line 2 has a `line-amount` warning (3 × 12,00 € = 36,00 € but the line says 42,00 €)
- **THEN** the question states the lines sum and the tax base
- **AND** it mentions that line 2 says 42,00 € where 3 × 12,00 € is 36,00 €

#### Scenario: Invalid tax id question
- **WHEN** the remaining error is `tax-ids` for the customer
- **THEN** the question names the customer, the value read and why it is invalid, and asks whether the document shows that value

### Requirement: Measure repair
The extraction eval command SHALL accept a repair option. With it, every document with rule errors goes through the same single repair. The report SHALL include per-field accuracy, exact-match rate and rule pass rate both before and after repair, and the number of repairs attempted and accepted.

#### Scenario: Repair on degraded photos
- **WHEN** the eval runs with repair on 20 degraded JPEGs
- **THEN** the summary shows before and after metrics and how many repairs were attempted and used
