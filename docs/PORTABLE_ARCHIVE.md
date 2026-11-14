# Portable Archive — design

Status: implemented (2026-09-23). Since November 2026 the system backup
(Settings → Systembackup, the scheduler and `python -m app.cli backup`) is the
pg_dump backup again, as the table under "Why" recommends. The archive is written
by `backup --json` and by the per-company export; both kinds can be restored.

Code: `backend/app/schemas/archive.py` (format), `archive_export_service.py`,
`archive_import_service.py`, `restore_service.py`, tests in
`tests/services/test_archive_roundtrip.py` and `tests/routers/test_backup_archive.py`.

Differences from the original proposal, as built:

- one format for both scopes: `manifest.scope` is `"instance"` (full backup:
  all companies + `instance/users.json` + `instance/settings.json`) or
  `"company"`; company data lives under `companies/<orgnr>/`;
- `files/` mirrors the uploads directory (`attachments/`, `logos/`,
  `ai_uploads/`) so a restore is a directory swap;
- `posting_templates`, `default_accounts`, `company_users` and `attachments`
  are exported as well; AI chat history and uploads under `ai/` unless
  `--no-ai`;
- period locks, gap explanations, reversal links and the audit log (behandlingshistorik)
  are part of the archive since October 2026 (`period_locks.json`, `gap_explanations.json`,
  `audit_log.jsonl` per company, `instance/audit_log.jsonl` for instance-wide entries);
- the SIE cross-check after import reports a warning rather than failing, since
  the ledger rows are inserted verbatim and already checked to balance.

## Why

The existing backup (`backup_service.py`) is a `pg_dump` custom-format dump plus
the `attachments/` directory in a tar.gz. It is the right tool for disaster
recovery of one installation, but it is not a migration format:

- it only restores into PostgreSQL, with a `pg_restore` at least as new as the
  `pg_dump` that wrote it;
- it is instance-wide (all companies, all users, AI settings) — no per-company
  export;
- it skips `uploads/logos/` and `uploads/ai_uploads/` (fixed: since layout 2
  the backup holds every uploads sub-directory, with SHA-256 per member);
- its contents are only meaningful to this exact schema version; a rewrite of
  Reknir on another stack (or another product) cannot consume it.

SIE4 is portable but carries only accounts, balances and verifications.

The portable archive fills the gap: one self-describing file per company that
another Reknir instance, a future Reknir on a different architecture, or an
unrelated program can read without access to the source database.

Keep the pg_dump backup. The two serve different purposes:

| | pg_dump backup | portable archive |
|---|---|---|
| purpose | restore this install after a disk failure | move, migrate, hand over, archive for 7 years |
| scope | whole instance | one company (+ optional instance bundle) |
| consumer | same Reknir, same-or-newer version, PostgreSQL | anything that reads zip + JSON |
| fidelity | byte-exact incl. ids, sessions, tokens | semantic: everything the bookkeeping needs |

## Format

A zip file, `reknir-archive-<orgnr>-<YYYYMMDD-HHMMSS>.zip`, with this layout:

```
manifest.json
schema/                      JSON Schema for every *.json / *.jsonl file below
  manifest.schema.json
  verification.schema.json
  ...
company.json
fiscal_years.json
accounts.jsonl               one row per (fiscal_year, account)
verifications.jsonl          one row per verification, transaction lines embedded
customers.json
suppliers.json
invoices.jsonl               lines + payments embedded
supplier_invoices.jsonl      lines + payments embedded
expenses.jsonl
posting_templates.json       lines embedded
default_accounts.json
attachments.jsonl            metadata + links; file lives under files/
files/
  attachments/<storage_filename>
  logo/<logo_filename>
sie/
  <fiscal_year_label>.se     SIE4 export per year (convenience + cross-check)
ai/                          optional, --include-ai
  chat_sessions.jsonl        messages embedded
  uploads.jsonl
  files/<storage_filename>
```

Rules that make it portable:

1. **Self-describing.** `schema/` holds JSON Schema generated from the Pydantic
   archive models (`model_json_schema()`). A consumer on another stack validates
   against those, not against Reknir source code.
2. **Versioned independently of the DB schema.** `manifest.format_version` is
   an integer the archive code owns. The Alembic revision is recorded for
   information only. The importer keeps `upgrade_v1_to_v2()`-style functions so
   old archives stay readable; this is the same discipline Alembic gives the
   database, applied to the file format.
3. **Plain scalar encoding.** Amounts as decimal strings (`"1234.50"`), never
   floats. Dates as `YYYY-MM-DD`. Timestamps as ISO 8601 in UTC with `Z`. Enums
   as their string values (`"accrual"`, `"issued"`, `"archived_pdf"`). No
   database-specific types anywhere.
4. **Ids are archive-local.** Every row keeps an `id` (the source primary key)
   and every reference uses the same integers (`customer_id`, `account_id`,
   `verification_id`). The importer builds an id map per table and rewrites
   references; ids in the file are only for joining within the archive. Natural
   keys are exported alongside so a human or a foreign program can join without
   the map: accounts carry `account_number` + `fiscal_year_label`, verifications
   carry `series` + `verification_number`, invoices carry `invoice_series` +
   `invoice_number`.
5. **Derived values are exported but not trusted.** `accounts.current_balance`,
   `invoice.paid_amount`, `invoice.payment_status` and the totals on lines are
   written to the archive so a reader gets them for free, and the importer
   recomputes them from transaction lines / payments and refuses the import if
   they disagree with the file. This turns the import into an integrity check of
   the source. `opening_balance` is real data (the first year's IB is entered by
   hand) and is imported as-is.
6. **Integrity.** `manifest.files[]` lists every member with size and SHA-256.
   Attachments already store `checksum_sha256`; the importer verifies the file
   matches the row before linking it.
7. **Streaming.** Tables that grow (verifications, invoices, attachments, chat
   messages) are JSON Lines so both writer and reader stream. Small reference
   tables are plain JSON arrays. Files are added with `zipfile.ZipFile.write`
   from disk, never read into memory.

### What is deliberately not in a company archive

- `users`, `company_users`, `invitations`, `ai_settings`, `backup_schedule` —
  instance-level; see bundle below. Invitations are never exported (tokens).
- `invoice.pdf_path` — legacy column; the archived PDF is the attachment with
  role `archived_pdf`, which is exported.
- Chat history and AI uploads unless `--include-ai` is given; they are not
  bookkeeping records.

### Instance bundle

`reknir-bundle-<timestamp>.zip` = `bundle.json` + `users.json` +
`settings.json` + one `companies/<orgnr>.zip` per company.

`users.json` contains email, full name, `is_admin`, `is_active` and the
per-company roles from `company_users`. The bcrypt hash is included only with
`--include-credentials`; bcrypt strings are portable to any bcrypt library, so a
rewrite can keep passwords. Without the flag, imported users get a reset flow.

## Manifest

```json
{
  "format": "reknir-archive",
  "format_version": 1,
  "created_at": "2026-09-12T10:41:03Z",
  "created_by": "reknir 1.3.4",
  "alembic_revision": "a1b2c3d4",
  "company": { "name": "Exempel AB", "org_number": "556677-8899" },
  "fiscal_years": ["2024", "2025", "2026"],
  "counts": { "verifications": 812, "invoices": 140, "attachments": 630 },
  "options": { "include_ai": false },
  "files": [
    { "path": "verifications.jsonl", "bytes": 412331, "sha256": "..." },
    { "path": "files/attachments/3f2a....pdf", "bytes": 88120, "sha256": "..." }
  ]
}
```

## Row shapes (abridged)

`verifications.jsonl`:

```json
{"id": 512, "fiscal_year_id": 3, "series": "A", "verification_number": 117,
 "transaction_date": "2026-03-04", "registration_date": "2026-03-05",
 "description": "Hyra mars", "locked": true,
 "lines": [
   {"id": 2001, "account_id": 88, "account_number": 5010, "debit": "12000.00", "credit": "0.00", "description": null},
   {"id": 2002, "account_id": 91, "account_number": 2640, "debit": "3000.00",  "credit": "0.00", "description": null},
   {"id": 2003, "account_id": 60, "account_number": 1930, "debit": "0.00",     "credit": "15000.00", "description": null}
 ]}
```

`attachments.jsonl`:

```json
{"id": 77, "original_filename": "hyra-mars.pdf", "storage_filename": "3f2a...pdf",
 "mime_type": "application/pdf", "size_bytes": 88120, "checksum_sha256": "...",
 "status": "ready", "rejection_reason": null, "created_at": "2026-03-05T08:12:00Z",
 "created_by_email": "joakim@example.se",
 "links": [{"entity_type": "verification", "entity_id": 512, "role": "original", "sort_order": 0}]}
```

`created_by` is exported as the user's email, not the user id, so it survives a
move to an instance with different users. The importer maps it to a local user
by email and falls back to the importing user.

## Import

`import_archive(zip, *, into_company=None, dry_run=False)`

1. Open zip, read and validate `manifest.json`, refuse `format_version` newer
   than supported, upgrade older formats in memory.
2. Verify every `manifest.files[]` entry (size + SHA-256). Stop on first mismatch.
3. Validate every JSON/JSONL row against the Pydantic archive models.
4. Load into a fresh company (default) or an existing empty company. Order:
   company → fiscal years → accounts → customers/suppliers → posting templates →
   default accounts → verifications → invoices/supplier invoices/expenses
   (these point at verifications) → attachments + links. One transaction.
5. Recompute derived values and compare to the archive (balances, paid amounts,
   invoice totals, that every verification balances, that verification numbers
   are unique per series and gap-free per year). Any difference → rollback with
   a report listing the rows.
6. Regenerate the SIE4 file for each year from the imported data and compare
   with `sie/<year>.se` from the archive, ignoring `#GEN` and ordering. This is
   the cheapest strong end-to-end check that the ledger survived intact.
7. Copy attachment files into `uploads/attachments/` (new storage filenames are
   fine; the row is updated) and the logo into `uploads/logos/`.

`--dry-run` runs steps 1–6 into a temporary company inside a transaction that is
always rolled back, and prints the report. The existing restore already has this
"restore into temp, validate, swap" shape; reuse its validation helpers.

Existing verifications in the target company are not merged. Importing into a
non-empty company is refused; that keeps numbering (Bokföringslagen requires an
unbroken series) out of the importer's hands.

## Round-trip test (the actual guarantee)

CI job: seed demo company → export archive A → import into new company →
export archive B → compare A and B after normalising ids, timestamps and
storage filenames. Also: import an archive from the previous `format_version`
fixture directory. Portability is a property of this test passing, not of the
design document.

## Interfaces

CLI (`python -m app.cli`):

```
archive export  --company 1 [--out DIR] [--include-ai]
archive import  FILE [--into-company ID] [--dry-run] [--include-ai]
archive verify  FILE            # steps 1–3 + 6 without touching the DB
bundle  export  [--include-credentials]
bundle  import  FILE
```

API: `POST /api/archive/export/{company_id}` (streams the zip),
`POST /api/archive/import` (multipart, returns the validation report),
`POST /api/archive/verify`. Frontend: an "Exportera företag" / "Importera
företag" pair next to the SIE buttons on the Settings page, and a "Skapa
arkiv" option on the backup tab. Admin-only.

## Implementation plan

Files, in build order:

1. `app/schemas/archive.py` — Pydantic models for every row and the manifest.
   This is the format spec; everything else derives from it.
2. `app/services/archive_export_service.py` — query per table, serialise,
   stream into zip, write SIE per year, manifest last.
3. `app/services/archive_import_service.py` — validate, id-map, load,
   recompute, compare, SIE cross-check. Reuse `sie4_service.export_sie4` and
   the validation helpers in `restore_service`.
4. `app/cli.py` — the commands above.
5. `tests/test_archive_roundtrip.py` — the round-trip test plus a fixture
   archive checked into `tests/fixtures/archive_v1/`.
6. `app/routers/archive.py` + Settings page buttons.
7. Bundle export/import on top of the company archive.

Two fixes to the existing backup that are independent of this work:

- archive `uploads/` (logos, ai_uploads) instead of only `uploads/attachments/`
  (done, layout 2);
- install `postgresql-client-16` from the PGDG apt repo in `backend/Dockerfile`
  so `pg_dump`/`pg_restore` match the `postgres:16` server instead of whatever
  Debian ships. Not done: the image already ships client 17, every pg_dump
  backup made so far is archive format 1.16, and pg_restore 16 refuses that
  ("unsupported version (1.16) in file header"). The client stays at or above
  the server version; the restore tolerates only the `SET transaction_timeout`
  that pg_restore 17 sends to a 16 server.

## Bokföringslagen note

Räkenskapsinformation must be kept seven years in a form that can be presented
in readable form. JSON plus the original PDFs/images plus SIE satisfies that
better than a pg_dump does, since it needs no specific software to open. An
exported archive per closed fiscal year, kept outside the server, is a good
habit once this exists.
