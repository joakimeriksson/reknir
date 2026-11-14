# Importing a company from Bokio

`python -m app.cli bokio-import` turns the files Bokio produces under
**Inställningar → Exportera data** into a Reknir company archive, which is then
imported with `import-company` (or **Importera företagsarkiv** under
**Systeminställningar → Företag**). Bokio's API is not needed; this works on the Basic plan.

## 1. Export from Bokio

Put everything in one folder:

| Bokio export | File | Used for |
|---|---|---|
| per fiscal year → SIE 4 | `<orgnr>_<year>.se` | chart of accounts, SRU codes, opening/closing balances, every verification |
| per fiscal year → Dokument | `Kvitton_<year>_<date>.zip` | receipts, named `V12.pdf`, `V3_1.png` (page 1 of V3) — attached to that verification |
| Exportera ej bokförda kvitton | `Kvitton_ej_bokforda_<date>.zip` | unlinked attachments |
| Exportera alla kunder | `Customers.csv` | customers |
| Exportera alla fakturor → Sammanfattning | `InvoiceSummaries.csv` | invoices (status, amounts, dates, sender address and bank details) |
| Exportera alla fakturor → Raddetaljer | `InvoiceRows.csv` | invoice lines |
| Exportera alla artiklar / anställda | `Articles.csv`, `Employees.csv` | ignored |

Export every fiscal year; the importer creates one Reknir fiscal year per SIE
file and one chart of accounts per year, as Reknir stores them.

## 2. Build the archive

```bash
python -m app.cli bokio-import ~/bokio-export botbox.zip --user you@example.com
# options: --close-through 2024   mark years up to 2024 closed (verifications locked);
#                                 default: every year except the last two
```

The command prints, per year, the number of verifications, the debit total and
whether the closing balance of every account recomputed from the verification
lines equals Bokio's `#UB`/`#RES` values. Warnings list receipts that did not
match a verification (they are still imported, unlinked) and invoices whose
verification could not be found by the text `Faktura #N`.

The archive is a normal company-scope archive (see `PORTABLE_ARCHIVE.md`) and
is verified before the command returns. The original SIE files are kept inside
it under `companies/<orgnr>/bokio/`.

## 3. Import

```bash
python -m app.cli import-company botbox.zip
```

The org number must not already exist in Reknir. Then seed posting templates
(`seed-templates <company_id>`) if wanted; Bokio's own templates are not exported.

## Mapping notes

- SIE `#TRANS` amounts: positive → debit, negative → credit.
- Account type from the account number class (1xxx asset, 2xxx equity/liability, 3xxx revenue, 4–8xxx costs).
- Invoices: `State=Paid` → paid; a payment row is created from `SumReceived`,
  dated by the matching "Faktura #N betalad" verification when found. The
  revenue account of each line is taken from the 3xxx credit line of the
  invoice's verification.
- Company address, phone, email and bank details come from the sender columns
  of `InvoiceSummaries.csv`; accounting method accrual, VAT quarterly. Adjust
  under Settings after import if needed.
- Not exported by Bokio, so not imported: the invoice PDFs as sent (download
  them from Fakturering and attach as "archived_pdf" if wanted), supplier
  invoices as documents (they are verifications with receipts), employees.
