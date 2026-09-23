# AGENTS.md — Invariant

Project conventions for humans and AI coding agents.

## Language
- **All code is written in English**: identifiers, comments, JSDoc, test names, error messages, log messages, commit messages, ADRs, specs and README.
- User-facing *data formats* may follow Spanish conventions (e.g. `formatMoney` renders `1.234,56 €`), because the product targets Spanish invoices. Formats are data, not code.

## Engineering
- Money is always integer cents (`number` validated with `Number.isSafeInteger`), never floats.
- TDD: write the failing test first (RED), then the implementation (GREEN), then refactor.
- Every non-trivial decision gets an ADR in `docs/adr/`.
- Conventional Commits, one logical change per commit, CI green before merging to `main`.
- Never commit secrets (`.env`) or real invoice data (`data/`).

## Commands
- `pnpm lint` · `pnpm format` · `pnpm typecheck` · `pnpm test`
