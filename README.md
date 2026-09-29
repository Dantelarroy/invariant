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

docker compose up -d                       # Postgres on localhost:5433, EN16931 validator on :8082
pnpm db:migrate
pnpm extract:text fixtures/text/invoice-001.txt   # needs OPENAI_API_KEY in .env
pnpm review <run-id> approve|reject        # answer a paused run
pnpm synth --count 50                      # synthetic Spanish invoices in data/synth
pnpm erp:up && pnpm erp:setup              # local FacturaScripts (real invoicing software)
pnpm synth:erp --count 50                  # invoices printed by FacturaScripts in data/synth-erp
pnpm eval:extract --dataset data/synth-erp --model gpt-5-mini --limit 20   # score extraction against labels
pnpm eval:extract --dataset data/synth --model gpt-5-mini --format jpg     # same, on degraded photos
pnpm ubl:check --dataset data/synth-erp --limit 50   # export labels to UBL and validate them (EN16931)
```

`eval:extract` reads `labels.jsonl` plus one `<id>.<format>` file per label (`--format pdf|jpg|png|webp`, default `pdf`; `--limit` defaults to 20). It prints a summary table and writes a JSON report to `data/evals/`, which is git-ignored like the rest of `data/`: reports never get committed. Scoring rules are in [ADR-0008](docs/adr/0008-scoring-extractions.md).

`ubl:check` exports each label to EN16931 UBL and validates it with the official CEN schematron, served by the `validator` service in `docker-compose.yml` (`easybill/en16931-validator`, at `EN16931_VALIDATOR_URL`, default `http://127.0.0.1:8082`). Without `--limit` it checks the whole dataset. It prints how many documents are valid, refused (no UBL without both parties' Spanish tax ids) and invalid, the failures per EN16931 rule and the warnings apart, and exits non-zero if any document is invalid. The UBL integration tests run when `EN16931_VALIDATOR_URL` is set. Mapping decisions are in [ADR-0009](docs/adr/0009-ubl-mapping.md), results in [docs/ubl.md](docs/ubl.md).

Conventions live in [`AGENTS.md`](./AGENTS.md).
