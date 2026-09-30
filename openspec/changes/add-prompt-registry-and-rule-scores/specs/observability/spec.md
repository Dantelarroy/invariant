# Spec Delta

## ADDED Requirements

### Requirement: Prompt registry pinned in code
The system SHALL provide a seed command that registers every prompt version defined in code in Langfuse prompt management, under its family name (`extract-text`, `extract-document`, `repair`), with Langfuse version N matching our id `<family>-vN`. The command SHALL skip versions whose text is identical, create missing versions in order, and fail without changing anything when a registered version has different text. At run time the system SHALL use the exact version the code pins: from Langfuse when tracing is on and the registry answers in time, otherwise the local text. A run MUST NOT fail or wait more than a few seconds because the registry is unavailable.

#### Scenario: Seeding twice
- **WHEN** the seed command runs twice in a row
- **THEN** the second run creates no new version

#### Scenario: Drift
- **WHEN** a registered version's text differs from the code's text for the same version
- **THEN** the seed command fails and names the prompt and version

#### Scenario: Registry down
- **WHEN** tracing is on but Langfuse does not answer
- **THEN** the run uses the local prompt text, and its generations are not linked to a registry prompt

### Requirement: Generations linked to prompt versions, with their data
When tracing is on, every extraction and repair generation SHALL be linked to its Langfuse prompt name and version, and SHALL record:
- **as input:** the prompt version and the source (text for text documents, a short description for files);
- **as output:** the extracted invoice in canonical shape.

Document bytes MUST NOT be recorded.

#### Scenario: Traced text extraction
- **WHEN** a text invoice is processed with tracing on
- **THEN** its extraction generation shows prompt `extract-text` version 1, the source text as input and the invoice as output

### Requirement: Rule results as scores
After each verification with tracing on, the system SHALL attach to the verified generation:
- a boolean score `rule.<ruleId>` for every rule (true when it passed), with the violation messages as comment and severity and details as metadata;
- a numeric score `rules.score` with the verifier score;
- a boolean score `rules.valid` that is true when no error rule failed.

Scores SHALL use deterministic ids, so sending them again updates them instead of duplicating them. Eval traces SHALL receive the same scores.

#### Scenario: Wrong total
- **WHEN** an extraction fails only the `total` rule
- **THEN** `rule.total` is false with the total message as comment, every other `rule.*` score is true, and `rules.valid` is false

#### Scenario: Repaired document
- **WHEN** a document is repaired
- **THEN** both the extraction and the repair generation have their own rule scores
