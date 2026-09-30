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
