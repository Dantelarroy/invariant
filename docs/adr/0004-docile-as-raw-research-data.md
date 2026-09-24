# ADR-0004: DocILE as raw research data behind a common document format

- **Status:** Accepted
- **Date:** 2026-09-24

## Context
Invariant needs many real business documents to evaluate extraction and to train a small model. DocILE (Rossum, ICDAR 2023) offers about 6.7k annotated and about 932k unlabeled invoice-like documents. Its code is MIT-licensed, but access to the data goes through a request form that grants it "for research purposes", and personal data in it is processed under a scientific-research legal basis.

DocILE annotations store *where* values are printed and their raw text ("1,210.00", "1 2 02"). They do not store normalized values.

## Decision
- A Python package (`python/data`, managed with uv) converts each dataset into one common JSONL format (`LabeledDocument`): id, split, metadata, header fields and line items, each field with its raw text, page and bounding box.
- The loader keeps raw text verbatim. Parsing amounts and dates belongs to the extractor and the rules, where it is tested and measured; a loader that normalizes silently would hide errors.
- Downloaded data lives only in the git-ignored `/data` directory and is never committed or redistributed. Tests use small, hand-written fixtures in the DocILE format.
- Before publishing anything trained on DocILE (planned for day 19), the terms accepted in the access form are reviewed again. Publishing may be limited to code, metrics and a model trained only on synthetic data.

## Consequences
- New datasets (synthetic Spanish invoices, the real test set) plug in by writing another loader to the same format.
- JSON uses camelCase so TypeScript and Python read the same records.
- Python quality gates (ruff, pytest) run in CI and in the pre-commit hook.
