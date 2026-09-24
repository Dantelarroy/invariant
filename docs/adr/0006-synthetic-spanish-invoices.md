# ADR-0006: Synthetic Spanish invoices, correct by construction

- **Status:** Accepted
- **Date:** 2026-09-24

## Context
DocILE is English and mostly USD (ADR-0004). The Spanish rules (VAT rates and per-rate VAT, IRPF, NIF/NIE/CIF) need Spanish documents with exact ground truth, in volume, without real personal or company data.

## Decision
- `@invariant/synth` generates invoices from a **seed** with a small PRNG (mulberry32). The same seed always gives the same document, so a dataset is fully described by its seed range and the code version.
- Data is correct by construction: valid tax ids (checked in tests against the independent validator in `@invariant/rules`), VAT computed per rate with the same `applyRate`, and 15 % IRPF for self-employed professionals. A test asserts that 500 generated invoices pass every rule with zero violations.
- Our own word lists instead of faker: faker's Spanish locale does not produce valid tax ids, and a fixed, small vocabulary keeps outputs stable across library upgrades.
- Three deliberately different templates (classic table, modern layout, narrow monospaced receipt) keep a model from learning positions instead of meaning.
- Playwright renders each document twice: a clean **PDF** (a digitally generated invoice) and a **JPEG** degraded with CSS only (rotation, blur, paper tint, SVG noise, JPEG quality), with no image-processing dependency. The degradation has its own seed stream.
- Output: `<id>.pdf`, `<id>.jpg` and `labels.jsonl` with the exact `Invoice`, the template and the augmentation parameters, in the git-ignored `/data`.

## Consequences
- Synthetic invoices are too clean to measure real accuracy. They are used for training and smoke tests; the real Spanish test set (day 9) is the benchmark.
- Rendering tests need Chromium; CI installs it.
- Current limitations, to extend when evals show the need: no multi-page invoices, no line discounts, no handwritten marks.
