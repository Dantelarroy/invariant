# Spec Delta

## Purpose

Read an invoice straight from its document (a PDF or a photo/scan) with a vision-capable model, and return the same validated invoice contract as the text extractor.

## ADDED Requirements

### Requirement: Extract an invoice from a PDF or image
The system SHALL accept a document as bytes plus a media type (`application/pdf`, `image/png`, `image/jpeg` or `image/webp`), send it to a vision-capable model, and return an invoice that satisfies the canonical invoice schema (shape only). It SHALL also return the prompt version used and the input and output token counts reported by the model.

#### Scenario: PDF invoice
- **WHEN** a single-page PDF invoice is extracted with a model that returns a well-formed invoice
- **THEN** the result contains a schema-valid invoice, with amounts in integer cents
- **AND** the result reports the document prompt version and the token usage

#### Scenario: Photo of an invoice
- **WHEN** a JPEG photo of an invoice is extracted
- **THEN** the document is sent to the model as an image, not as text
- **AND** the result contains a schema-valid invoice

### Requirement: Reject unsupported documents before calling the model
The system MUST reject a document whose media type is not supported, and a document with no bytes, without calling the model and without spending tokens.

#### Scenario: Unsupported media type
- **WHEN** a document with media type `text/html` is extracted
- **THEN** extraction fails with an error that names the media type and lists the supported ones
- **AND** the model is not called

#### Scenario: Empty document
- **WHEN** a document with zero bytes is extracted
- **THEN** extraction fails with an error saying the document is empty
- **AND** the model is not called

### Requirement: Schema-invalid model output is an error, not a guess
The system MUST fail the extraction when the model output cannot be converted into a schema-valid invoice. It MUST NOT fill in or invent missing fields. Business-rule checks stay outside the extractor.

#### Scenario: Model returns amounts that are not integers
- **WHEN** the model output has a total that is not an integer number of cents
- **THEN** extraction fails with a validation error

#### Scenario: Internally inconsistent but well-formed output
- **WHEN** the model returns a well-formed invoice whose lines do not add up to the tax base
- **THEN** extraction succeeds and returns that invoice unchanged, so the rule verifier can flag it

### Requirement: Versioned document prompt
The instructions sent to the model for documents SHALL live in their own versioned prompt, separate from the text prompt. Every extraction result SHALL carry that version, so results produced with different prompts can be told apart.

#### Scenario: Prompt version in results
- **WHEN** any document is extracted
- **THEN** the result's prompt version identifies the document prompt (for example `extract-document-v1`), not the text prompt
