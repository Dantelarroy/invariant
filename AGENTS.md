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

## Workflow
Pick a route by risk before starting, and escalate only on new evidence.
- **Trivial** (typo, formatting, obvious rename): edit, check the diff, done.
- **Small change with logic** (bounded bug, small behavior change): failing test first, minimal fix, one focused check.
- **Feature, ambiguous or broad change** (new package, pipeline stage, schema or data format): spec first with OpenSpec (`openspec/`).
  1. `/opsx:propose` creates `openspec/changes/<name>/` with the proposal, spec deltas (Given/When/Then), design and tasks.
  2. The author approves the proposal before any code is written.
  3. `/opsx:apply` implements the tasks test-first; decisions become ADRs.
  4. `/opsx:archive` merges the spec deltas into `openspec/specs/` once the PR is merged.

Every change lands through a branch and a pull request with green CI; `main` is protected.

## Commands
- `pnpm lint` · `pnpm format` · `pnpm typecheck` · `pnpm test`
