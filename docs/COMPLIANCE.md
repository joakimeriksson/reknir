# Bookkeeping rules (Bokföringslagen) in Reknir

What Reknir enforces, where, and how to work with it. Added October 2026.

## 1. Posted verifications are immutable

`PATCH /api/verifications/{id}` is refused in production (`DEBUG=False`). A
mistake is corrected with a **reversal** (ändringsverifikation):

    POST /api/verifications/{id}/reverse   {"transaction_date": "2026-04-02", "description": "..."}

The reversal gets the next number in the same series, swaps debit and credit on
the same accounts, and both verifications point at each other
(`reverses_verification_id` / `reversed_by_verification_id`). A verification can
be reversed once. In the UI: verification page → **Skapa rättelse (vändning)**.
Deleting verifications remains possible only with `DEBUG=True`.

## 2. Verification numbers restart every fiscal year

Numbering is sequential per company, series **and fiscal year**
(`ledger_service.next_verification_number`). This matches BFNAR 2013:2 and the
way SIE files and other programs (Bokio, Fortnox) number vouchers.

## 3. Period locks

    GET  /api/companies/{id}/period-locks
    POST /api/companies/{id}/period-locks   {"locked_through": "2026-03-31", "note": "Moms Q1 deklarerad"}

Nothing can be posted with a transaction date on or before `locked_through`:
manual verifications, invoice and payment postings, expenses and reversals all
check `ledger_service.assert_period_open` and answer 403. Locking also sets
`locked=true` on the verifications up to that date. A lock only moves forward;
every lock is kept as history. In the UI: **Rapporter → Momsrapport → Lås
perioden** (pre-filled with the period's last day) and **Inställningar → Låst period**.

## 4. Gaps in a series are detected and explained

    GET  /api/verifications/gaps?company_id=&fiscal_year_id=
    POST /api/verifications/gaps/explain   {"company_id", "fiscal_year_id", "series", "verification_number", "explanation"}

The dashboard shows unexplained gaps with an inline field for the explanation
(`verification_gap_explanations`). Explained gaps disappear from the dashboard
but stay queryable.

## 5. Audit log (behandlingshistorik)

Every insert, update and delete on bookkeeping tables (verifications, invoices,
payments, expenses, accounts, customers, suppliers, company, fiscal years,
templates, default accounts, period locks, gap explanations, users and access)
is written to `audit_log` by SQLAlchemy mapper events in the same transaction,
with the acting user's email (set per request by the auth dependency) and, for
updates, the old and new value of each changed field. Bulk operations (archive
import, restore) write a single summary entry instead.

    GET /api/audit-log/?company_id=&table_name=&record_id=&limit=

Shown on each verification page (**Historik**) and under **Inställningar →
Behandlingshistorik**. The log, the period locks, the gap explanations and the
reversal links are all part of the portable archive, so a restore keeps them.

## 6. Reports added

- **Åldersanalys** (`GET /api/reports/aging?kind=customer|supplier&as_of=`):
  open invoices bucketed by days overdue, per counterpart and per invoice.
- **Kassaflödesanalys** (`GET /api/reports/cash-flow?fiscal_year_id=`):
  monthly movements on 19xx accounts, direct method, grouped by what they were
  posted against (sales, purchases, personnel, VAT and tax, financing, investments).

Both under **Rapporter**.

## 7. Deadlines

    GET /api/companies/{id}/deadlines

Computed from the company's VAT period and fiscal years, nothing is downloaded:
VAT declarations (12th of the second month after the period, 17 August for the
June period, moved past weekends, public holidays and the eves Skatteverket
treats as holidays), and for an AB the INK2 return, the årsredovisning to
Bolagsverket (7 months after year end) and the årsstämma (6 months). Shown on
the dashboard with days left; a deadline turns green once its period is locked.

## Still by convention, not enforced

- 7-year retention of attachments (deletion is possible for unlinked files).
- Closing a fiscal year (`is_closed`) is a flag set by import or manually; there
  is no year-end workflow yet.
