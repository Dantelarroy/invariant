# ADR-0009: Mapping canonical invoices to EN16931 UBL

- **Status:** Accepted
- **Date:** 2026-09-29

## Context
The end product of Invariant is an EN16931 e-invoice that validates, not only a ledger row (RD 238/2026 makes B2B e-invoicing mandatory in Spain). The canonical `Invoice` (`@invariant/schema`) holds party names and optional tax ids, lines, tax base, VAT, optional IRPF withholding and total. It has no addresses, countries, units of measure, due dates or payment means, while EN16931 requires a country for both parties, a VAT identifier for the seller and a unit code on every line.

We must decide which of those fields we may derive, what to do when the data is not enough, and how our printed numbers map to EN16931 totals, whose rules (BR-CO-*) check sums exactly.

## Decision
`@invariant/ubl` exposes a pure `toUbl(invoice)` that returns `{ kind: "ubl", xml }` or `{ kind: "refused", reasons }`. The XML is UBL 2.1, declares `urn:cen.eu:en16931:2017`, and is built with `xmlbuilder2`, in the element order of the UBL 2.1 Invoice schema.

1. **Derived fields, justified by a valid Spanish tax id.**
   - Country `ES` for both parties: a valid NIF, NIE or CIF implies a Spanish party.
   - Seller and buyer VAT identifier (BT-31, BT-48) `ES` + tax id: a party charging or receiving Spanish VAT holds a NIF-IVA, whose EN16931 form is the country prefix plus the NIF.
   - Legal registration id (BT-30, BT-47): the bare tax id, next to the registration name.
   - Unit `C62` ("one"): an explicit "unspecified" unit. It is imprecise for goods sold by weight, which we accept until units are extracted.
   - VAT category `S` for rates above 0 and `Z` for 0 %. `E` (exempt) would need an exemption reason we do not capture.
   - Type code `380` (commercial invoice), currency `EUR`.
2. **Refusal instead of invention.** No UBL is produced when either party has no tax id, or a tax id that is not a valid Spanish NIF, NIE or CIF. Foreign EU VAT numbers are refused too, because they do not justify country `ES`. Refusal is a value that lists every reason, naming the party; exceptions are kept for programming errors. A ticket to a private customer is expected input, not a failure.
3. **VAT breakdown by rate.** Lines are grouped by rate, highest first. The taxable amount is the sum of the line amounts at that rate, and the tax is `applyRate` of it. BR-CO-14 requires the breakdown taxes to add up to the document VAT exactly, while our `vat-amount` rule tolerates one cent. When the printed VAT differs from the breakdown sum by one cent, that cent goes to the standard-rated breakdown with the largest taxable amount (never to a 0 % one, where BR-Z-09 requires a zero tax). BR-S-09 accepts that cent because it checks each breakdown's tax with a tolerance.
4. **Totals copy the printed values.** Sum of line amounts (BT-106) = sum of the lines; tax base (BT-109) = printed base; VAT (BT-110) = printed VAT; total with VAT (BT-112) = base + VAT; payable (BT-115) = BT-112. Real programs print rounded lines but compute the base from unrounded amounts (ADR-0005, ADR-0007), so BT-106 can differ from BT-109 by cents and BR-CO-13 then fails. We report that instead of rewriting printed numbers; `pnpm ubl:check` measures how often it happens ([docs/ubl.md](../ubl.md)).
5. **IRPF as `cac:WithholdingTaxTotal`**, placed after `cac:TaxTotal`, with the amount and tax scheme `IRPF`, following the OASIS guidance for Spanish IRPF. No taxable amount or rate is written, because the canonical invoice does not carry them. EN16931 does not model withholding: the validator warns (UBL-CR-513) and the totals stay gross, so the payable amount is base + VAT and the net due after withholding lives only in the withholding element.
6. **Amounts** are written with two decimals from integer cents, by integer division and remainder, with an explicit sign.

## Consequences
- On the FacturaScripts dataset, 234 of 300 invoices produce valid UBL, 61 are refused (no buyer tax id) and 5 fail BR-CO-13 by one rounding cent. All 26 exportable invoices of our own templates validate ([docs/ubl.md](../ubl.md)).
- The warning UBL-CR-513 appears on every invoice with IRPF. Only errors decide validity.
- `C62` and the derived country are visible approximations. Extracting addresses and units is a schema and prompt change, deferred until the real benchmark exists.
- Fixing BR-CO-13 needs a later decision, made with the measured evidence: a document-level rounding allowance or charge, or labels regenerated from printed lines.
- The validator checks the schematron, not the XSD. The mapper's tests pin the full element order to compensate.
