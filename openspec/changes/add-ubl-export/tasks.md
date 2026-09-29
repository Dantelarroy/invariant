# Tasks

## 1. Package and mapper

- [ ] 1.1 Scaffold `packages/ubl` (`@invariant/ubl`, following `packages/evals`) with `xmlbuilder2`, `@invariant/schema` and `@invariant/rules`. Verify with `pnpm install && pnpm typecheck`.
- [ ] 1.2 RED: add `to-ubl.test.ts` covering:
  - two VAT rates (lines, breakdowns and totals);
  - `123456` → `1234.56`;
  - ES country and `ES` + NIF for valid tax ids;
  - C62 and categories S/Z;
  - refusal for a missing buyer tax id and for an invalid seller tax id;
  - IRPF as a withholding tax total with a gross payable amount (the 1762.37 / 370.10 / 264.36 example);
  - a one-cent VAT difference absorbed by the largest breakdown;
  - a snapshot of the element order for a full invoice.

  Verify that the tests fail.
- [ ] 1.3 GREEN: implement `toUbl` and cents formatting with integer arithmetic only. Verify with `pnpm test packages/ubl`.
- [ ] 1.4 Write `docs/adr/0009-ubl-mapping.md` (derived fields, refusal, VAT breakdown adjustment, printed totals and rounding, IRPF) and link it from `docs/architecture.md`. Verify that the link resolves.

## 2. Validator service and client

- [ ] 2.1 Add the `validator` service to `docker-compose.yml` (0.7.0, `127.0.0.1:8082:8080`, healthcheck) and `EN16931_VALIDATOR_URL` to `.env.example`. Verify with `docker compose up -d --wait validator` and `curl` on `/health`.
- [ ] 2.2 RED/GREEN: `validateUbl` with a fake `fetch`. Verify with `pnpm test packages/ubl`. Cases:
  - 200 → valid, with its warnings mapped;
  - 400 → errors mapped to `{ ruleId, severity, message }`;
  - 422, 500, a malformed body and a network error each throw with the URL.
- [ ] 2.3 Integration test against the real service, skipped when `EN16931_VALIDATOR_URL` is unset. Verify locally with the service up. Cases:
  - the UBL of a correct synthetic invoice is valid (warnings allowed);
  - a UBL with a tampered total is invalid, with a BR-CO rule id.
- [ ] 2.4 CI: add the validator service container and its env to `.github/workflows/ci.yml`. Verify in the PR that the integration test runs and is not skipped.

## 3. Dataset check

- [ ] 3.1 Add `src/cli/check-dataset.ts` and the root script `ubl:check` (`--dataset`, `--limit`). Verify with `pnpm ubl:check --dataset data/synth --limit 30`. It must:
  - print the valid, refused (with reasons) and invalid counts;
  - print warnings apart and the failures per rule id;
  - exit non-zero on any invalid document.
- [ ] 3.2 Run it on all 300 invoices of `data/synth-erp` and record in `docs/ubl.md` the counts, which rules fail and why (for example rounding in BR-CO-10/13), and what that means for the next decision. Verify that the numbers match the command output.
- [ ] 3.3 Document `ubl:check` and the validator service in `README.md`. Verify that the commands run as written.

## 4. Integration

- [ ] 4.1 With Postgres and the validator up, run `pnpm lint && pnpm typecheck && pnpm test && pnpm py:check`. Open the PR and confirm that CI is green.
