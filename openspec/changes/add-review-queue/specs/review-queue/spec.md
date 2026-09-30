# Spec Delta

## Purpose

Turn human review into an annotation loop: paused documents go to a Langfuse queue, a completed review resumes the run (with corrections), and every reviewed document becomes a golden record.

## ADDED Requirements

### Requirement: Paused documents enter the review queue
When a run pauses for review and tracing is on, the system SHALL add the chosen extraction's generation to the `invariant-review` annotation queue exactly once. It SHALL create the queue and its `verdict` score config (`correct`, `corrected`, `unusable`) if they are missing. Tracing off, or a Langfuse failure, MUST NOT prevent the run from pausing normally.

#### Scenario: Wrong total pauses
- **WHEN** a text invoice with a wrong printed total is processed with tracing on
- **THEN** its extraction generation appears once in the queue, with its source text, extracted invoice and rule scores

#### Scenario: Langfuse down
- **WHEN** the same document is processed while Langfuse is unreachable
- **THEN** the run still pauses for review, and the queue failure is logged

### Requirement: Completed reviews resume their runs
The system SHALL provide a sync command that reads completed queue items and resumes the matching paused run:
- verdict `correct`: approve with the extracted invoice;
- verdict `corrected`: approve with the reviewer's corrected invoice;
- verdict `unusable`: reject.

A corrected invoice MUST be validated against the invoice schema before resuming. If it is invalid, the item is reported and the run stays paused. An item whose run is no longer paused SHALL be reported and skipped, never resumed twice. Running the command again SHALL change nothing new.

#### Scenario: Corrected total
- **WHEN** the reviewer sets `corrected` and changes the total to 102,85 € in the corrected output
- **THEN** sync resumes the run, and the persisted invoice has total 10285 cents, reviewed by the reviewer

#### Scenario: Invalid correction
- **WHEN** the corrected output is not valid invoice JSON
- **THEN** sync reports that document with the validation error, and the run stays paused

#### Scenario: Idempotent sync
- **WHEN** sync runs twice
- **THEN** the second run resumes nothing and reports the items as already resolved

### Requirement: Resume with a corrected invoice
A review decision SHALL optionally carry a corrected invoice. When it does, and it is approved, the workflow SHALL persist the corrected invoice instead of the extraction and record who reviewed it. A decision without a corrected invoice SHALL behave exactly as before.

#### Scenario: Terminal review unchanged
- **WHEN** a paused run is approved with `pnpm review <runId> approve`
- **THEN** the extracted invoice is persisted as before

### Requirement: Golden set export
The system SHALL export every reviewed document with verdict `correct` or `corrected` to `data/golden/golden.jsonl`, one JSON record per document. Each record holds:
- the document id and the verdict;
- the confirmed invoice (the correction, or the extraction when correct), valid against the invoice schema;
- the source text;
- the trace id, the observation id and the prompt version;
- the review time.

Records SHALL be upserted by document id. `unusable` documents SHALL be excluded. The golden invoice is "as printed" and MUST NOT be required to pass the business rules.

#### Scenario: Export after ten reviews
- **WHEN** ten documents are reviewed as `correct` or `corrected` and the export runs
- **THEN** `golden.jsonl` has ten records, and running the export again still has ten

### Requirement: Review fixtures with known errors
The system SHALL generate text invoices rendered from seeded synthetic invoices, each with exactly one injected printed error from a fixed set: wrong total, wrong VAT amount, invalid tax id, or a line amount that does not match. It SHALL write a manifest naming each file's injected error and the correct value. Given the same seed and count, output SHALL be identical.

#### Scenario: Twelve fixtures
- **WHEN** fixtures are generated with count 12 and seed 1
- **THEN** there are 12 text files and a manifest, every error type appears at least twice, and regenerating gives identical files
