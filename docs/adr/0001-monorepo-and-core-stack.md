# ADR-0001: TypeScript monorepo and core stack

- **Status:** Accepted
- **Date:** 2026-09-23

## Context
Invariant has many parts that change together (schema, rules, extractor, UBL, agent, API) plus a Python training pipeline. We need fast feedback, one set of quality rules, and a stack aligned with the target industry (TypeScript, mastra, Langfuse, Postgres, GCP).

## Decision
- **pnpm workspaces monorepo** (`apps/*`, `packages/*`); Python lives under `python/` with `uv`.
- **Node 24 LTS** pinned in `.nvmrc`; **TypeScript** in strict mode with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- **Biome** for lint and format, **Vitest** for tests.
- **Postgres (pgvector image) + Drizzle ORM** as the system of record (the ledger). Migrations are generated and committed.
- **Money is integer cents**, never floats.
- Quality gates: Husky hooks locally (pre-commit, commit-msg) and GitHub Actions CI (lint, typecheck, migrations + tests against a real Postgres, commitlint, gitleaks). `main` is protected: PR plus green CI required.

## Consequences
- One install and one CI pipeline for every package; cross-package changes are tested together.
- Integration tests run against a real database, locally (docker compose, port 5433) and in CI (service container).
- Contributors need Docker, Node 24 and pnpm.
- Drizzle keeps SQL visible, so migrations are reviewable in PRs.
