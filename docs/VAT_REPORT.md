# Momsrapport och momsdeklaration

Reknir builds the Swedish VAT return (momsdeklaration, form SKV 4700) straight from
the ledger. There are no VAT codes on transactions; every box is derived from BAS
account numbers, so the return is right exactly when the bookkeeping follows BAS.
Code: `backend/app/services/vat_report_service.py`.

## Where the figures come from

| Box | Content | Accounts |
|-----|---------|----------|
| 05 | Momspliktig försäljning | 3000–3799 unless listed below (3740 öresutjämning ignored) |
| 35 / 36 | Varor till annat EU-land / utanför EU | 3106 / 3105 |
| 39 / 40 | Tjänster till näringsidkare i EU / omsatta utom landet | 3308 / 3305 |
| 41 | Köparen skattskyldig i Sverige (byggsektorn) | 3231 |
| 42 | Momsfri försäljning | 3004, 3014, 3044, 3054 |
| 10 / 11 / 12 | Utgående moms 25 / 12 / 6 % | 2610–2619 / 2620–2629 / 2630–2639 |
| 20 | Inköp av varor från annat EU-land | 4515–4517 |
| 21 | Inköp av tjänster från annat EU-land | 4535–4537 |
| 22 | Inköp av tjänster utanför EU | 4531–4533 |
| 23 / 24 | Omvänd skattskyldighet i Sverige, varor / tjänster | 4415–4417 / 4425–4427 |
| 30 / 31 / 32 | Utgående moms på inköp (ruta 20–24) | 2614, 2617 / 2624, 2627 / 2634, 2637 |
| 50 | Beskattningsunderlag vid import | 4545–4547 |
| 60 / 61 / 62 | Utgående moms på import | 2615 / 2625 / 2635 |
| 48 | Ingående moms | 2640–2649 |
| 49 | Att betala eller få tillbaka | sum of 10–12, 30–32, 60–62 minus 48 |

Revenue accounts in 3800–3999 and purchase accounts in 4400–4599 without a rule
(e.g. 3900 Övriga rörelseintäkter, 4500 Inköp utanför Sverige) are listed under
"Konton utanför deklarationen" and raise a warning instead of being guessed.

## Rounding

Each box is reported in whole kronor with the öre dropped (toward zero). Box 49 is
computed from the rounded boxes, not from the exact net, so 30 000,00 out and
7 906,60 in gives 30 000 − 7 906 = **22 094**, which is what Skatteverket expects
and what Bokio books.

## Settlements

The verification that moves a period's VAT to the tax account is not business VAT.
With "Exkludera momsavräkningar" (the default) Reknir ignores verifications that
touch 1630, 1650, 2650 or 2660, or whose description contains momsredovisning,
momsdeklaration or momsavräkning. A period that has already been settled therefore
still shows what was declared.

## Checks before you file

The report warns when the books do not add up to a plausible return:

- a box other than 49 is negative (credit notes, corrections);
- box 10/11/12 does not match the rate applied to box 05 when only one rate is in
  use (typical cause: accruals or corrections booked over a 3xxx account without VAT);
- output VAT on reverse charge (30–32) without purchases in 20–24, or the reverse;
- import VAT (60–62) without a base in box 50;
- activity on unmapped accounts.

Warnings do not change the figures. Fix the bookkeeping, or correct the box by hand
at Skatteverket if the books are right and the warning is a false alarm.

## eSKD file

"Ladda ner XML-fil" produces an `eSKDUpload` 6.0 document with the elements in DTD
order, only the non-zero boxes plus `MomsBetala`, for upload under *Lämna
momsdeklaration*. `Period` is the last month of the period (`YYYYMM`).

## Verification

The mapping and rounding were checked against the 47 quarterly Momsredovisning
verifications Bokio booked for BotBox AB 2015–2026, including reverse charge and
import. All quarters agree box by box; three differ by one 300 kr input-VAT item that
Bokio itself moved between periods by hand. Synthetic cases live in
`backend/tests/services/test_vat_report_service.py` and
`backend/tests/routers/test_vat_declaration.py`; the Bokio Q3 2026 file is reproduced
byte for byte in `test_vat_report_xml.py`.
