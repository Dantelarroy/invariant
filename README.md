# Invariant

Turns messy business documents (invoice PDFs, scans and photos) into verifiable accounting data and EN16931 UBL e-invoices.

Invoices obey rules that can be checked without knowing the right answer: line items add up to the subtotal, Spanish VAT is 21/10/4 %, tax IDs have check digits, and the output must pass the official EN16931 validator. Invariant uses those invariants to:

1. **Know when to ask instead of guess.** A broken rule triggers a targeted repair or a specific question to a human.
2. **Evaluate without labels.** The rule pass rate is an online quality metric.
3. **Train a small model with RL.** Rules become the reward (GRPO), so unlabeled documents can be used for training.

**Status:** day 8. Text invoices go through a mastra workflow (ingest → extract → verify → human review → persist) into Postgres.

## Development

Requirements: Node 24 (see `.nvmrc`, e.g. via `fnm`) and pnpm 10.

```sh
pnpm install
pnpm lint        # Biome checks
pnpm typecheck   # TypeScript in every package
pnpm test        # Vitest

docker compose up -d                       # Postgres on localhost:5433
pnpm db:migrate
pnpm extract:text fixtures/text/invoice-001.txt   # needs OPENAI_API_KEY in .env
pnpm review <run-id> approve|reject        # answer a paused run
pnpm synth --count 50                      # synthetic Spanish invoices in data/synth
pnpm erp:up && pnpm erp:setup              # local FacturaScripts (real invoicing software)
pnpm synth:erp --count 50                  # invoices printed by FacturaScripts in data/synth-erp
```

Conventions live in [`AGENTS.md`](./AGENTS.md).
