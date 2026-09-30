# observability Specification

## Purpose
Make every processed or evaluated document leave a trace in a local, self-hosted Langfuse. Each trace records the document's steps, model calls, tokens, cost and latency, and those traces are turned into a cost and latency report.

## Requirements

### Requirement: Local Langfuse on demand
The system SHALL provide commands to start and stop a self-hosted Langfuse stack locally. The stack SHALL bind only to `127.0.0.1`, cap each service's memory, disable usage telemetry to Langfuse, and create its organization, project, user and API keys on first start without manual steps. Starting it again SHALL keep existing data.

#### Scenario: First start
- **WHEN** the author runs the start command on a machine without the stack
- **THEN** Langfuse answers on `http://127.0.0.1:3000` once healthy
- **AND** the local project and API keys exist, with no manual step in the UI

#### Scenario: Restart keeps traces
- **WHEN** the stack is stopped and started again
- **THEN** traces recorded before are still there

### Requirement: Tracing is opt-in
The system SHALL send traces only when `LANGFUSE_BASE_URL` is set. Without it, workflow runs, CLIs and tests SHALL behave exactly as before, and no network call to Langfuse SHALL be made.

#### Scenario: Tests and CI
- **WHEN** the test suite runs without `LANGFUSE_BASE_URL`
- **THEN** no trace is sent, and results are the same as without this change

### Requirement: One trace per workflow run
When tracing is on, each document processed by the workflow SHALL produce one trace containing:
- a span per executed step;
- a generation per model call (extraction and repair), with model, prompt version, input and output tokens, and latency;
- trace metadata with the document id, model and prompt version.

The trace SHALL carry a branch as metadata and as a tag, one of `accepted`, `repaired`, `needs_review`, `failed`, `rejected` or `duplicate`. CLI commands SHALL flush traces before exiting.

#### Scenario: Accepted by rules
- **WHEN** a text invoice with no rule errors is processed
- **THEN** its trace has the steps ingest, extract, verify, repair, human-review and persist
- **AND** it has one generation named after the extraction prompt version, and branch `accepted`

#### Scenario: Repaired
- **WHEN** a document is accepted after a repair
- **THEN** its trace has two generations (extraction and `repair-v1`) and branch `repaired`

#### Scenario: Needs review
- **WHEN** a run pauses for review
- **THEN** its trace has branch `needs_review`, and the review question appears in the human-review step output

### Requirement: One trace per evaluated document
When tracing is on, the eval command SHALL send one trace per document in the `eval` environment. Each trace SHALL include the extraction generation (and the repair generation when repair is enabled), the dataset, document id and model as metadata, and the exact-match and rule verdict. Document bytes MUST NOT be sent. Traces SHALL be flushed before the command exits.

#### Scenario: Traced eval run
- **WHEN** the eval runs with tracing on over 50 FacturaScripts PDFs
- **THEN** Langfuse has 50 traces in the `eval` environment, each with its generation, tokens and metadata, and no document bytes

### Requirement: Cost and latency report
The system SHALL provide a report command that reads traces from Langfuse for a time window and environment. It SHALL print the number of traces, total cost, and p50 and p95 latency per model, per prompt version (generation name) and per branch, using the cost Langfuse computes from model and token usage.

#### Scenario: Report after the 50-document run
- **WHEN** the report runs over the window of the 50-document eval
- **THEN** it prints 50 traces, their total cost, and p50/p95 latency per model and prompt version

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
