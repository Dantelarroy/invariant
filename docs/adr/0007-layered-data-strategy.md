# ADR-0007: Layered data strategy, with real invoicing software as a source

- **Status:** Accepted
- **Date:** 2026-09-24

## Context
There is no public dataset of real, modern Spanish invoices. We checked Hugging Face, Kaggle, Roboflow, GitHub, Wikimedia Commons and Reddit. We also mined FinePDFs, the 26 M Spanish PDFs crawled from the web: 0 invoices among the first 20,000 documents. Invoices hold personal and tax data, so nobody publishes them on purpose.

Mining PDFs exposed by mistake on the web (e.g. `factura_123.pdf` in Common Crawl) would yield some, but they contain real people's names, tax ids and addresses. We reject that on GDPR and ethical grounds.

## Decision
We build data in layers, each with a clear purpose:

1. **Real benchmark (small, curated).** Published example invoices, plus the author's own invoices and invoices from people who consent. It is kept locally only, in `/data/real`, with a manifest of sources and licenses. This is the only layer used to report accuracy.
2. **Real invoicing software (scalable).** [FacturaScripts](https://github.com/NeoRazorX/facturascripts), open source and used by Spanish SMEs, runs in Docker (`infra/erp`). Our generator's invoices are created through its API, and the PDFs it prints are kept. Labels use the number and totals the software computed. Other programs (Odoo with l10n-spain, Dolibarr) can be added the same way for layout diversity.
3. **Own templates (controlled).** `@invariant/synth` covers edge cases on demand.
4. **DocILE (layout reading).** Real English documents (ADR-0004).

## Consequences
- Running real software surfaced facts that our own templates would have hidden:
  - Invoices in a series must be dated in numbering order (FacturaScripts refuses otherwise), so batches are created sorted by date.
  - The software prints rounded lines but computes the base from unrounded amounts, so lines can differ from the base by cents. The `lines-sum` rule now tolerates half a cent per line (ADR-0005).
  - Quantities are printed with a dot ("1.5"), unlike amounts ("1,50").
- The ERP setup is fully scripted (`pnpm erp:up && pnpm erp:setup`). It works around three installer and API gaps: an empty socket field, lazily created tables with a sticky "checked" cache, and the default logo.
- One ERP gives one layout. Diversity must come from adding more ERPs, company logos and photographed prints, not from more invoices from the same program.
- ERP integration is not run in CI (it needs MySQL and PHP). The API client is unit-tested with a fake `fetch`, and the generator checks every label against the rules.
