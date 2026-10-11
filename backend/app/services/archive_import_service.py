"""Verify and import portable JSON + files archives (see archive_export_service).

Two entry points:

- ``verify_archive(zip_path)``: structural check without touching any database —
  manifest, format version, size + SHA-256 of every member, and every row
  validated against the archive schema. Returns the parsed archive.
- ``load_archive(db, archive, uploads_target, ...)``: writes the archive's rows
  into ``db`` (which may be a temporary database) and copies files into
  ``uploads_target`` (which mirrors the uploads directory: attachments/,
  logos/, ai_uploads/). Every id is remapped; users are matched by email.

``load_archive`` never commits — the caller decides (the full restore commits into
a temporary database and swaps it in; a company import commits into production).
"""

from __future__ import annotations

import hashlib
import json
import logging
import shutil
import zipfile
import zlib
from dataclasses import dataclass, field
from datetime import UTC, datetime, time
from pathlib import Path
from typing import Any, TypeVar

from pydantic import BaseModel, ValidationError
from sqlalchemy.orm import Session

from app.models.account import Account, AccountType
from app.models.ai_assistant import AISettings, AIUpload, ChatMessage, ChatSession
from app.models.attachment import Attachment, AttachmentLink, AttachmentRole, AttachmentStatus, EntityType
from app.models.backup_schedule import BackupSchedule
from app.models.company import AccountingBasis, Company, PaymentType, VATReportingPeriod
from app.models.compliance import AuditLog, PeriodLock, VerificationGapExplanation
from app.models.customer import Customer, Supplier
from app.models.default_account import DefaultAccount
from app.models.expense import Expense, ExpenseStatus
from app.models.fiscal_year import FiscalYear
from app.models.invoice import (
    Invoice,
    InvoiceLine,
    InvoicePayment,
    InvoiceStatus,
    PaymentStatus,
    SupplierInvoice,
    SupplierInvoiceLine,
    SupplierInvoicePayment,
)
from app.models.posting_template import PostingTemplate, PostingTemplateLine
from app.models.user import CompanyUser, User
from app.models.verification import TransactionLine, Verification
from app.schemas import archive as fmt
from app.services import audit_service
from app.services.archive_export_service import AI_UPLOADS_SUBDIR, ATTACHMENTS_SUBDIR, LOGOS_SUBDIR
from app.services.sie4_service import export_sie4

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)


class ArchiveError(Exception):
    """The archive is unreadable, corrupt, or violates the format."""


# ---------------------------------------------------------------------------
# reading
# ---------------------------------------------------------------------------


@dataclass
class CompanyData:
    entry: fmt.CompanyEntry
    company: fmt.CompanyRow
    company_users: list[fmt.CompanyUserRow]
    fiscal_years: list[fmt.FiscalYearRow]
    accounts: list[fmt.AccountRow]
    verifications: list[fmt.VerificationRow]
    customers: list[fmt.CustomerRow]
    suppliers: list[fmt.SupplierRow]
    invoices: list[fmt.InvoiceRow]
    supplier_invoices: list[fmt.SupplierInvoiceRow]
    expenses: list[fmt.ExpenseRow]
    posting_templates: list[fmt.PostingTemplateRow]
    default_accounts: list[fmt.DefaultAccountRow]
    attachments: list[fmt.AttachmentRow]
    period_locks: list[fmt.PeriodLockRow] = field(default_factory=list)
    gap_explanations: list[fmt.GapExplanationRow] = field(default_factory=list)
    audit_log: list[fmt.AuditLogRow] = field(default_factory=list)
    chat_sessions: list[fmt.ChatSessionRow] = field(default_factory=list)
    ai_uploads: list[fmt.AIUploadRow] = field(default_factory=list)
    sie: dict[str, str] = field(default_factory=dict)  # fiscal year label -> SIE text


@dataclass
class ArchiveData:
    path: Path
    manifest: fmt.Manifest
    users: list[fmt.UserRow]
    settings: fmt.InstanceSettings | None
    companies: list[CompanyData]
    instance_audit_log: list[fmt.AuditLogRow] = field(default_factory=list)

    def open(self) -> zipfile.ZipFile:
        return zipfile.ZipFile(self.path, "r")


def _safe_member(name: str) -> None:
    if name.startswith("/") or name.startswith("\\") or ".." in name.split("/") or ":" in name.split("/")[0]:
        raise ArchiveError(f"Archive contains unsafe path: {name}")


def _read_text(zf: zipfile.ZipFile, name: str, required: bool = True) -> str | None:
    try:
        with zf.open(name) as f:
            return f.read().decode("utf-8")
    except KeyError:
        if required:
            raise ArchiveError(f"Archive is missing {name}") from None
        return None


def _parse_json(zf: zipfile.ZipFile, name: str, model: type[T], required: bool = True) -> list[T]:
    text = _read_text(zf, name, required)
    if text is None:
        return []
    try:
        raw = json.loads(text)
    except json.JSONDecodeError as e:
        raise ArchiveError(f"{name}: invalid JSON: {e}") from e
    if not isinstance(raw, list):
        raise ArchiveError(f"{name}: expected a JSON array")
    return [_validate(model, item, f"{name}[{i}]") for i, item in enumerate(raw)]


def _parse_jsonl(zf: zipfile.ZipFile, name: str, model: type[T], required: bool = True) -> list[T]:
    text = _read_text(zf, name, required)
    if text is None:
        return []
    rows = []
    for i, line in enumerate(text.splitlines()):
        if not line.strip():
            continue
        try:
            raw = json.loads(line)
        except json.JSONDecodeError as e:
            raise ArchiveError(f"{name}:{i + 1}: invalid JSON: {e}") from e
        rows.append(_validate(model, raw, f"{name}:{i + 1}"))
    return rows


def _parse_one(zf: zipfile.ZipFile, name: str, model: type[T], required: bool = True) -> T | None:
    text = _read_text(zf, name, required)
    if text is None:
        return None
    try:
        raw = json.loads(text)
    except json.JSONDecodeError as e:
        raise ArchiveError(f"{name}: invalid JSON: {e}") from e
    return _validate(model, raw, name)


def _validate(model: type[T], raw: Any, where: str) -> T:
    try:
        return model.model_validate(raw)
    except ValidationError as e:
        first = e.errors()[0]
        loc = ".".join(str(p) for p in first.get("loc", ()))
        raise ArchiveError(f"{where}: {loc}: {first.get('msg')}") from e


def read_manifest(zip_path: Path) -> fmt.Manifest:
    """Read only the manifest (used for listing backups)."""
    try:
        with zipfile.ZipFile(zip_path, "r") as zf:
            manifest = _parse_one(zf, "manifest.json", fmt.Manifest)
    except zipfile.BadZipFile as e:
        raise ArchiveError(f"Not a zip archive: {e}") from e
    assert manifest is not None
    return manifest


def verify_archive(zip_path: Path) -> ArchiveData:
    """Check integrity and schema of an archive. Raises ArchiveError on any problem."""
    try:
        zf = zipfile.ZipFile(zip_path, "r")
    except (zipfile.BadZipFile, OSError) as e:
        raise ArchiveError(f"Not a readable zip archive: {e}") from e

    try:
        with zf:
            return _verify_open_archive(zf, zip_path)
    except (zipfile.BadZipFile, zlib.error, OSError) as e:
        raise ArchiveError(f"Archive is corrupt: {e}") from e


def _verify_open_archive(zf: zipfile.ZipFile, zip_path: Path) -> ArchiveData:
    for info in zf.infolist():
        _safe_member(info.filename)

    manifest = _parse_one(zf, "manifest.json", fmt.Manifest)
    assert manifest is not None
    if manifest.format != fmt.FORMAT_NAME:
        raise ArchiveError(f"Unknown archive format: {manifest.format}")
    if manifest.format_version > fmt.FORMAT_VERSION:
        raise ArchiveError(
            f"Archive format version {manifest.format_version} is newer than supported "
            f"({fmt.FORMAT_VERSION}). Upgrade Reknir first."
        )

    # Every listed member must exist, with the recorded size and hash; every
    # member (except the manifest itself) must be listed.
    listed = {entry.path: entry for entry in manifest.files}
    present = {info.filename for info in zf.infolist() if not info.is_dir()}
    missing = sorted(set(listed) - present)
    if missing:
        raise ArchiveError(f"{len(missing)} member(s) listed in manifest are missing: {missing[:5]}")
    unlisted = sorted(present - set(listed) - {"manifest.json"})
    if unlisted:
        raise ArchiveError(f"{len(unlisted)} member(s) not listed in manifest: {unlisted[:5]}")

    for path, entry in listed.items():
        digest = hashlib.sha256()
        size = 0
        with zf.open(path) as f:
            while chunk := f.read(1024 * 1024):
                digest.update(chunk)
                size += len(chunk)
        if size != entry.bytes:
            raise ArchiveError(f"{path}: size {size} does not match manifest ({entry.bytes})")
        if digest.hexdigest() != entry.sha256:
            raise ArchiveError(f"{path}: SHA-256 does not match manifest")

    users: list[fmt.UserRow] = []
    settings: fmt.InstanceSettings | None = None
    instance_audit: list[fmt.AuditLogRow] = []
    if manifest.scope == "instance":
        users = _parse_json(zf, "instance/users.json", fmt.UserRow)
        settings = _parse_one(zf, "instance/settings.json", fmt.InstanceSettings, required=False)
        instance_audit = _parse_jsonl(zf, "instance/audit_log.jsonl", fmt.AuditLogRow, required=False)

    companies: list[CompanyData] = []
    for entry in manifest.companies:
        base = entry.path.rstrip("/")
        company = _parse_one(zf, f"{base}/company.json", fmt.CompanyRow)
        assert company is not None
        if company.org_number != entry.org_number:
            raise ArchiveError(f"{base}: org number in company.json differs from manifest")
        data = CompanyData(
            entry=entry,
            company=company,
            company_users=_parse_json(zf, f"{base}/company_users.json", fmt.CompanyUserRow, required=False),
            fiscal_years=_parse_json(zf, f"{base}/fiscal_years.json", fmt.FiscalYearRow),
            accounts=_parse_jsonl(zf, f"{base}/accounts.jsonl", fmt.AccountRow),
            verifications=_parse_jsonl(zf, f"{base}/verifications.jsonl", fmt.VerificationRow),
            customers=_parse_json(zf, f"{base}/customers.json", fmt.CustomerRow),
            suppliers=_parse_json(zf, f"{base}/suppliers.json", fmt.SupplierRow),
            invoices=_parse_jsonl(zf, f"{base}/invoices.jsonl", fmt.InvoiceRow),
            supplier_invoices=_parse_jsonl(zf, f"{base}/supplier_invoices.jsonl", fmt.SupplierInvoiceRow),
            expenses=_parse_jsonl(zf, f"{base}/expenses.jsonl", fmt.ExpenseRow),
            posting_templates=_parse_json(zf, f"{base}/posting_templates.json", fmt.PostingTemplateRow),
            default_accounts=_parse_json(zf, f"{base}/default_accounts.json", fmt.DefaultAccountRow),
            attachments=_parse_jsonl(zf, f"{base}/attachments.jsonl", fmt.AttachmentRow),
            period_locks=_parse_json(zf, f"{base}/period_locks.json", fmt.PeriodLockRow, required=False),
            gap_explanations=_parse_json(zf, f"{base}/gap_explanations.json", fmt.GapExplanationRow, required=False),
            audit_log=_parse_jsonl(zf, f"{base}/audit_log.jsonl", fmt.AuditLogRow, required=False),
        )
        if manifest.includes_ai:
            data.chat_sessions = _parse_jsonl(zf, f"{base}/ai/chat_sessions.jsonl", fmt.ChatSessionRow, required=False)
            data.ai_uploads = _parse_jsonl(zf, f"{base}/ai/uploads.jsonl", fmt.AIUploadRow, required=False)
        for fy in data.fiscal_years:
            sie = _read_text(zf, f"{base}/sie/{_dirname(fy.label)}.se", required=False)
            if sie is not None:
                data.sie[fy.label] = sie

        # Referential checks inside the archive
        _check_references(data)

        # Every attachment must have its file in the archive
        for att in data.attachments:
            member = f"files/{ATTACHMENTS_SUBDIR}/{att.storage_filename}"
            if member not in present:
                raise ArchiveError(f"{base}: attachment {att.id} ({att.original_filename}) has no file {member}")
            if att.checksum_sha256 and listed[member].sha256 != att.checksum_sha256:
                raise ArchiveError(f"{base}: attachment {att.id} file hash differs from its recorded checksum")
        companies.append(data)

    return ArchiveData(
        path=zip_path,
        manifest=manifest,
        users=users,
        settings=settings,
        companies=companies,
        instance_audit_log=instance_audit,
    )


def _dirname(label: str) -> str:
    import re

    return re.sub(r"[^0-9A-Za-z-]", "", label) or "company"


def _check_references(data: CompanyData) -> None:
    fy_ids = {fy.id for fy in data.fiscal_years}
    acc_ids = {a.id for a in data.accounts}
    ver_ids = {v.id for v in data.verifications}
    cust_ids = {c.id for c in data.customers}
    sup_ids = {s.id for s in data.suppliers}
    inv_ids = {i.id for i in data.invoices}
    sinv_ids = {i.id for i in data.supplier_invoices}
    exp_ids = {e.id for e in data.expenses}
    base = data.entry.path

    def need(cond: bool, msg: str) -> None:
        if not cond:
            raise ArchiveError(f"{base}: {msg}")

    for a in data.accounts:
        need(
            a.fiscal_year_id in fy_ids, f"account {a.account_number} references unknown fiscal year {a.fiscal_year_id}"
        )
    seen_numbers: set[tuple[int, str, int]] = set()
    for v in data.verifications:
        need(
            v.fiscal_year_id in fy_ids, f"verification {v.series}{v.verification_number} references unknown fiscal year"
        )
        key = (v.fiscal_year_id, v.series, v.verification_number)
        need(key not in seen_numbers, f"duplicate verification number {v.series}{v.verification_number}")
        seen_numbers.add(key)
        debit = sum(line.debit for line in v.lines)
        credit = sum(line.credit for line in v.lines)
        need(abs(debit - credit) < 0.005, f"verification {v.series}{v.verification_number} does not balance")
        for line in v.lines:
            need(
                line.account_id in acc_ids, f"verification {v.series}{v.verification_number} references unknown account"
            )
        for ref in (v.reverses_verification_id, v.reversed_by_verification_id):
            need(
                ref is None or ref in ver_ids,
                f"verification {v.series}{v.verification_number} reversal link to unknown verification {ref}",
            )
    for g in data.gap_explanations:
        need(
            g.fiscal_year_id in fy_ids,
            f"gap explanation {g.series}{g.verification_number} references unknown fiscal year",
        )
    for i in data.invoices:
        need(i.customer_id in cust_ids, f"invoice {i.invoice_series}{i.invoice_number} references unknown customer")
        for ref in (i.invoice_verification_id, i.payment_verification_id):
            need(ref is None or ref in ver_ids, f"invoice {i.invoice_number} references unknown verification {ref}")
        for p in i.payments:
            need(
                p.verification_id is None or p.verification_id in ver_ids,
                f"invoice {i.invoice_number} payment references unknown verification",
            )
            need(
                p.bank_account_id is None or p.bank_account_id in acc_ids,
                f"invoice {i.invoice_number} payment references unknown account",
            )
    for i in data.supplier_invoices:
        need(i.supplier_id in sup_ids, f"supplier invoice {i.supplier_invoice_number} references unknown supplier")
        for ref in (i.invoice_verification_id, i.payment_verification_id):
            need(
                ref is None or ref in ver_ids,
                f"supplier invoice {i.supplier_invoice_number} references unknown verification {ref}",
            )
    for e in data.expenses:
        need(
            e.verification_id is None or e.verification_id in ver_ids, f"expense {e.id} references unknown verification"
        )
        for ref in (e.expense_account_id, e.vat_account_id):
            need(ref is None or ref in acc_ids, f"expense {e.id} references unknown account {ref}")
    for d in data.default_accounts:
        need(d.account_id in acc_ids, f"default account {d.account_type} references unknown account")
    targets = {"verification": ver_ids, "invoice": inv_ids, "supplier_invoice": sinv_ids, "expense": exp_ids}
    for att in data.attachments:
        for link in att.links:
            need(link.entity_type in targets, f"attachment {att.id} has unknown entity type {link.entity_type}")
            need(
                link.entity_id in targets[link.entity_type],
                f"attachment {att.id} links to unknown {link.entity_type} {link.entity_id}",
            )


# ---------------------------------------------------------------------------
# loading
# ---------------------------------------------------------------------------


@dataclass
class ImportReport:
    created: dict[str, int] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    company_ids: list[int] = field(default_factory=list)

    def bump(self, key: str, n: int = 1) -> None:
        self.created[key] = self.created.get(key, 0) + n


def _naive(dt: datetime | None) -> datetime | None:
    """Archive timestamps are UTC-aware; most columns are naive UTC."""
    if dt is None:
        return None
    if dt.tzinfo is not None:
        dt = dt.astimezone(UTC).replace(tzinfo=None)
    return dt


def _aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=UTC)


def _enum(cls, value):
    if value is None:
        return None
    try:
        return cls(value)
    except ValueError as e:
        raise ArchiveError(f"invalid {cls.__name__} value: {value!r}") from e


class _IdMap(dict):
    def __init__(self, what: str):
        super().__init__()
        self.what = what

    def get_required(self, old_id: int) -> int:
        try:
            return self[old_id]
        except KeyError:
            raise ArchiveError(f"unresolved {self.what} id {old_id}") from None

    def get_optional(self, old_id: int | None) -> int | None:
        return None if old_id is None else self.get_required(old_id)


def load_archive(
    db: Session,
    archive: ArchiveData,
    *,
    uploads_target: Path | None,
    import_users: bool,
    fallback_user: User | None = None,
    include_ai: bool = True,
) -> ImportReport:
    """Insert the archive into ``db`` and copy files into ``uploads_target``.

    import_users: create users from instance/users.json (full restore). When
        False, company users are matched to existing users by email.
    fallback_user: used for created_by references whose email is not found.
    Does not commit.
    """
    report = ImportReport()
    users_by_email: dict[str, User] = {u.email: u for u in db.query(User).all()}

    # ---- users & instance settings ----
    if import_users and archive.manifest.scope == "instance":
        # Owners first, so a service account can be created with its owner_id set
        # in the same INSERT (a later UPDATE would bump updated_at via onupdate).
        for row in sorted(archive.users, key=lambda r: r.owner_email is not None):
            if row.email in users_by_email:
                report.warnings.append(f"user {row.email} already exists, kept existing")
                continue
            owner_id = None
            if row.owner_email:
                owner = users_by_email.get(row.owner_email)
                if owner is None:
                    report.warnings.append(f"service account {row.email}: owner {row.owner_email} not found")
                else:
                    db.flush()
                    owner_id = owner.id
            user = User(
                email=row.email,
                full_name=row.full_name,
                is_admin=row.is_admin,
                is_active=row.is_active,
                hashed_password=row.hashed_password or _unusable_password(),
                is_service_account=row.is_service_account,
                owner_id=owner_id,
                api_key_hash=row.api_key_hash,
                created_at=_naive(row.created_at),
                updated_at=_naive(row.updated_at),
            )
            if row.hashed_password is None and not row.is_service_account:
                report.warnings.append(f"user {row.email}: archive has no credentials, password must be reset")
            if row.is_service_account and row.api_key_hash is None:
                report.warnings.append(f"service account {row.email}: archive has no API key, rotate it after restore")
            db.add(user)
            users_by_email[row.email] = user
            report.bump("users")
        db.flush()

        if archive.settings:
            _apply_settings(db, archive.settings, users_by_email, report)
        for a in archive.instance_audit_log:
            db.add(
                AuditLog(
                    company_id=None,
                    user_email=a.user_email,
                    action=a.action,
                    table_name=a.table_name,
                    record_id=None,
                    summary=a.summary,
                    changes=json.dumps(a.changes, ensure_ascii=False) if a.changes else None,
                    created_at=_naive(a.created_at),
                )
            )
        report.bump("audit_log", len(archive.instance_audit_log))

    if fallback_user is None:
        fallback_user = next((u for u in users_by_email.values() if u.is_admin), None) or next(
            iter(users_by_email.values()), None
        )

    def user_id(email: str | None, what: str, required: bool = False) -> int | None:
        """Resolve a user reference by email. Optional references stay None when
        unknown; required ones (created_by on attachments) fall back to fallback_user."""
        if email and email in users_by_email:
            return users_by_email[email].id
        if email is None and not required:
            return None
        if email:
            report.warnings.append(
                f"{what}: user {email} not found, " + ("using fallback" if required else "reference cleared")
            )
        if not required:
            return None
        return fallback_user.id if fallback_user else None

    existing_org_numbers = {c.org_number for c in db.query(Company.org_number).all()}

    with archive.open() as zf, audit_service.suppressed():
        for data in archive.companies:
            if data.company.org_number in existing_org_numbers:
                raise ArchiveError(f"A company with org number {data.company.org_number} already exists")
            company_id = _load_company(db, zf, data, archive, report, user_id, uploads_target, include_ai)
            report.company_ids.append(company_id)
            existing_org_numbers.add(data.company.org_number)

    db.flush()
    for data, cid in zip(archive.companies, report.company_ids, strict=True):
        audit_service.note(
            db,
            company_id=cid,
            summary=f"import company {data.company.name} from archive {archive.path.name}",
            table_name="companies",
            record_id=cid,
        )
    db.flush()
    return report


def _unusable_password() -> str:
    # bcrypt hash of a random secret nobody knows; login requires a reset.
    import secrets

    from app.services.auth_service import get_password_hash

    return get_password_hash(secrets.token_urlsafe(32))


def _apply_settings(db: Session, settings: fmt.InstanceSettings, users_by_email: dict[str, User], report: ImportReport):
    if settings.ai_settings:
        ai = db.query(AISettings).order_by(AISettings.id).first()
        if ai is None:
            ai = AISettings(id=1)
            db.add(ai)
        ai.ai_enabled = settings.ai_settings.ai_enabled
        ai.ollama_url = settings.ai_settings.ollama_url
        ai.ollama_model = settings.ai_settings.ollama_model
        ai.system_prompt = settings.ai_settings.system_prompt
        report.bump("ai_settings")
    if settings.backup_schedule:
        sched = db.query(BackupSchedule).order_by(BackupSchedule.id).first()
        if sched is None:
            sched = BackupSchedule(id=1)
            db.add(sched)
        sched.enabled = settings.backup_schedule.enabled
        sched.interval_hours = settings.backup_schedule.interval_hours
        sched.max_backups = settings.backup_schedule.max_backups
        h, m = settings.backup_schedule.preferred_time.split(":")
        sched.preferred_time = time(int(h), int(m))
        report.bump("backup_schedule")
    db.flush()


def _copy_member(zf: zipfile.ZipFile, member: str, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    with zf.open(member) as src, open(target, "wb") as dst:
        shutil.copyfileobj(src, dst, 1024 * 1024)


def _load_company(
    db, zf, data: CompanyData, archive: ArchiveData, report: ImportReport, user_id, uploads_target, include_ai
) -> int:
    c = data.company
    company = Company(
        name=c.name,
        org_number=c.org_number,
        address=c.address,
        postal_code=c.postal_code,
        city=c.city,
        phone=c.phone,
        email=c.email,
        fiscal_year_start=c.fiscal_year_start,
        fiscal_year_end=c.fiscal_year_end,
        accounting_basis=_enum(AccountingBasis, c.accounting_basis),
        vat_reporting_period=_enum(VATReportingPeriod, c.vat_reporting_period),
        is_vat_registered=c.is_vat_registered,
        logo_filename=c.logo_filename,
        payment_type=_enum(PaymentType, c.payment_type),
        bankgiro_number=c.bankgiro_number,
        plusgiro_number=c.plusgiro_number,
        clearing_number=c.clearing_number,
        account_number=c.account_number,
        iban=c.iban,
        bic=c.bic,
    )
    db.add(company)
    db.flush()
    report.bump("companies")
    tag = c.org_number

    # company users
    seen_users: set[int] = set()
    for cu in data.company_users:
        uid = user_id(cu.email, f"{tag} company_users")
        if uid is None or uid in seen_users:
            continue
        seen_users.add(uid)
        db.add(
            CompanyUser(
                company_id=company.id,
                user_id=uid,
                role=cu.role,
                created_by=user_id(cu.created_by_email, f"{tag} company_users.created_by"),
                created_at=_naive(cu.created_at),
            )
        )
        report.bump("company_users")

    # fiscal years
    fy_map = _IdMap("fiscal year")
    for fy in data.fiscal_years:
        obj = FiscalYear(
            company_id=company.id,
            year=fy.year,
            label=fy.label,
            start_date=fy.start_date,
            end_date=fy.end_date,
            is_closed=fy.is_closed,
        )
        db.add(obj)
        db.flush()
        fy_map[fy.id] = obj.id
    report.bump("fiscal_years", len(data.fiscal_years))

    # accounts
    acc_map = _IdMap("account")
    for a in data.accounts:
        obj = Account(
            company_id=company.id,
            fiscal_year_id=fy_map.get_required(a.fiscal_year_id),
            account_number=a.account_number,
            name=a.name,
            description=a.description,
            account_type=_enum(AccountType, a.account_type),
            opening_balance=a.opening_balance,
            current_balance=a.current_balance,
            active=a.active,
            is_bas_account=a.is_bas_account if a.is_bas_account is not None else True,
            sru_code=a.sru_code,
        )
        db.add(obj)
        db.flush()
        acc_map[a.id] = obj.id
    report.bump("accounts", len(data.accounts))

    # customers / suppliers
    cust_map = _IdMap("customer")
    for cr in data.customers:
        obj = Customer(company_id=company.id, **cr.model_dump(exclude={"id"}))
        db.add(obj)
        db.flush()
        cust_map[cr.id] = obj.id
    report.bump("customers", len(data.customers))

    sup_map = _IdMap("supplier")
    for sr in data.suppliers:
        fields_ = sr.model_dump(exclude={"id", "payment_type"})
        obj = Supplier(company_id=company.id, payment_type=_enum(PaymentType, sr.payment_type), **fields_)
        db.add(obj)
        db.flush()
        sup_map[sr.id] = obj.id
    report.bump("suppliers", len(data.suppliers))

    # posting templates
    for t in data.posting_templates:
        obj = PostingTemplate(
            company_id=company.id,
            name=t.name,
            description=t.description,
            default_series=t.default_series,
            default_journal_text=t.default_journal_text,
            sort_order=t.sort_order,
            created_at=_naive(t.created_at),
            updated_at=_naive(t.updated_at),
        )
        db.add(obj)
        db.flush()
        for line in t.lines:
            db.add(
                PostingTemplateLine(
                    template_id=obj.id,
                    account_number=line.account_number,
                    formula=line.formula,
                    description=line.description,
                    sort_order=line.sort_order,
                )
            )
    report.bump("posting_templates", len(data.posting_templates))

    # default accounts
    for d in data.default_accounts:
        db.add(
            DefaultAccount(
                company_id=company.id, account_type=d.account_type, account_id=acc_map.get_required(d.account_id)
            )
        )
    report.bump("default_accounts", len(data.default_accounts))

    # verifications
    ver_map = _IdMap("verification")
    for v in data.verifications:
        obj = Verification(
            company_id=company.id,
            fiscal_year_id=fy_map.get_required(v.fiscal_year_id),
            verification_number=v.verification_number,
            series=v.series,
            transaction_date=v.transaction_date,
            registration_date=v.registration_date,
            description=v.description,
            locked=v.locked,
            created_at=_naive(v.created_at),
            updated_at=_naive(v.updated_at),
        )
        db.add(obj)
        db.flush()
        ver_map[v.id] = obj.id
        for line in v.lines:
            db.add(
                TransactionLine(
                    verification_id=obj.id,
                    account_id=acc_map.get_required(line.account_id),
                    debit=line.debit,
                    credit=line.credit,
                    description=line.description,
                )
            )
    for v in data.verifications:
        if v.reverses_verification_id is not None or v.reversed_by_verification_id is not None:
            # Core-level update with updated_at given explicitly, so the column's
            # onupdate does not stamp a new time on an imported row.
            db.query(Verification).filter(Verification.id == ver_map.get_required(v.id)).update(
                {
                    "reverses_verification_id": ver_map.get_optional(v.reverses_verification_id),
                    "reversed_by_verification_id": ver_map.get_optional(v.reversed_by_verification_id),
                    "updated_at": _naive(v.updated_at),
                },
                synchronize_session=False,
            )
    db.flush()
    report.bump("verifications", len(data.verifications))

    # invoices
    inv_map = _IdMap("invoice")
    for i in data.invoices:
        obj = Invoice(
            company_id=company.id,
            customer_id=cust_map.get_required(i.customer_id),
            invoice_number=i.invoice_number,
            invoice_series=i.invoice_series,
            invoice_date=i.invoice_date,
            due_date=i.due_date,
            paid_date=i.paid_date,
            reference=i.reference,
            our_reference=i.our_reference,
            total_amount=i.total_amount,
            vat_amount=i.vat_amount,
            net_amount=i.net_amount,
            status=_enum(InvoiceStatus, i.status),
            payment_status=_enum(PaymentStatus, i.payment_status),
            paid_amount=i.paid_amount,
            notes=i.notes,
            message=i.message,
            invoice_verification_id=ver_map.get_optional(i.invoice_verification_id),
            payment_verification_id=ver_map.get_optional(i.payment_verification_id),
            pdf_path=i.pdf_path,
            payment_type=_enum(PaymentType, i.payment_type),
            bankgiro_number=i.bankgiro_number,
            plusgiro_number=i.plusgiro_number,
            clearing_number=i.clearing_number,
            account_number=i.account_number,
            iban=i.iban,
            bic=i.bic,
            created_at=_naive(i.created_at),
            updated_at=_naive(i.updated_at),
            sent_at=_naive(i.sent_at),
        )
        db.add(obj)
        db.flush()
        inv_map[i.id] = obj.id
        for line in i.lines:
            db.add(
                InvoiceLine(
                    invoice_id=obj.id,
                    description=line.description,
                    quantity=line.quantity,
                    unit=line.unit,
                    unit_price=line.unit_price,
                    vat_rate=line.vat_rate,
                    account_id=acc_map.get_optional(line.account_id),
                    net_amount=line.net_amount,
                    vat_amount=line.vat_amount,
                    total_amount=line.total_amount,
                )
            )
        for p in i.payments:
            db.add(
                InvoicePayment(
                    invoice_id=obj.id,
                    payment_date=p.payment_date,
                    amount=p.amount,
                    verification_id=ver_map.get_optional(p.verification_id),
                    bank_account_id=acc_map.get_optional(p.bank_account_id),
                    reference=p.reference,
                    notes=p.notes,
                    created_at=_naive(p.created_at),
                )
            )
    report.bump("invoices", len(data.invoices))

    # supplier invoices
    sinv_map = _IdMap("supplier invoice")
    for i in data.supplier_invoices:
        obj = SupplierInvoice(
            company_id=company.id,
            supplier_id=sup_map.get_required(i.supplier_id),
            supplier_invoice_number=i.supplier_invoice_number,
            our_invoice_number=i.our_invoice_number,
            invoice_date=i.invoice_date,
            due_date=i.due_date,
            paid_date=i.paid_date,
            total_amount=i.total_amount,
            vat_amount=i.vat_amount,
            net_amount=i.net_amount,
            status=_enum(InvoiceStatus, i.status),
            payment_status=_enum(PaymentStatus, i.payment_status),
            paid_amount=i.paid_amount,
            ocr_number=i.ocr_number,
            reference=i.reference,
            notes=i.notes,
            invoice_verification_id=ver_map.get_optional(i.invoice_verification_id),
            payment_verification_id=ver_map.get_optional(i.payment_verification_id),
            created_at=_naive(i.created_at),
            updated_at=_naive(i.updated_at),
        )
        db.add(obj)
        db.flush()
        sinv_map[i.id] = obj.id
        for line in i.lines:
            db.add(
                SupplierInvoiceLine(
                    supplier_invoice_id=obj.id,
                    description=line.description,
                    quantity=line.quantity,
                    unit_price=line.unit_price,
                    vat_rate=line.vat_rate,
                    account_id=acc_map.get_optional(line.account_id),
                    net_amount=line.net_amount,
                    vat_amount=line.vat_amount,
                    total_amount=line.total_amount,
                )
            )
        for p in i.payments:
            db.add(
                SupplierInvoicePayment(
                    supplier_invoice_id=obj.id,
                    payment_date=p.payment_date,
                    amount=p.amount,
                    verification_id=ver_map.get_optional(p.verification_id),
                    bank_account_id=acc_map.get_optional(p.bank_account_id),
                    reference=p.reference,
                    notes=p.notes,
                    created_at=_naive(p.created_at),
                )
            )
    report.bump("supplier_invoices", len(data.supplier_invoices))

    # expenses
    exp_map = _IdMap("expense")
    for e in data.expenses:
        obj = Expense(
            company_id=company.id,
            employee_name=e.employee_name,
            expense_date=e.expense_date,
            description=e.description,
            amount=e.amount,
            vat_amount=e.vat_amount,
            expense_account_id=acc_map.get_optional(e.expense_account_id),
            vat_account_id=acc_map.get_optional(e.vat_account_id),
            status=_enum(ExpenseStatus, e.status),
            approved_date=_naive(e.approved_date),
            paid_date=_naive(e.paid_date),
            verification_id=ver_map.get_optional(e.verification_id),
            created_at=_naive(e.created_at),
            updated_at=_naive(e.updated_at),
        )
        db.add(obj)
        db.flush()
        exp_map[e.id] = obj.id
    report.bump("expenses", len(data.expenses))

    # attachments + files
    entity_maps = {"verification": ver_map, "invoice": inv_map, "supplier_invoice": sinv_map, "expense": exp_map}
    for att in data.attachments:
        creator = user_id(att.created_by_email, f"{tag} attachment {att.id}", required=True)
        if creator is None:
            raise ArchiveError(f"{tag}: attachment {att.id} needs a creating user but no user exists")
        obj = Attachment(
            company_id=company.id,
            original_filename=att.original_filename,
            storage_filename=att.storage_filename,
            mime_type=att.mime_type,
            size_bytes=att.size_bytes,
            checksum_sha256=att.checksum_sha256,
            status=_enum(AttachmentStatus, att.status),
            rejection_reason=att.rejection_reason,
            created_at=_naive(att.created_at),
            created_by=creator,
        )
        db.add(obj)
        db.flush()
        for link in att.links:
            db.add(
                AttachmentLink(
                    attachment_id=obj.id,
                    entity_type=_enum(EntityType, link.entity_type),
                    entity_id=entity_maps[link.entity_type].get_required(link.entity_id),
                    role=_enum(AttachmentRole, link.role),
                    sort_order=link.sort_order,
                    created_at=_naive(link.created_at),
                )
            )
        if uploads_target is not None:
            _copy_member(
                zf,
                f"files/{ATTACHMENTS_SUBDIR}/{att.storage_filename}",
                uploads_target / ATTACHMENTS_SUBDIR / att.storage_filename,
            )
    report.bump("attachments", len(data.attachments))

    if c.logo_filename and uploads_target is not None:
        member = f"files/{LOGOS_SUBDIR}/{c.logo_filename}"
        try:
            _copy_member(zf, member, uploads_target / LOGOS_SUBDIR / c.logo_filename)
        except KeyError:
            report.warnings.append(f"{tag}: logo file {c.logo_filename} not in archive, logo cleared")
            company.logo_filename = None

    # period locks, gap explanations, processing history
    for p in data.period_locks:
        db.add(
            PeriodLock(
                company_id=company.id,
                locked_through=p.locked_through,
                note=p.note,
                created_by=user_id(p.created_by_email, f"{tag} period lock"),
                created_at=_naive(p.created_at),
            )
        )
    report.bump("period_locks", len(data.period_locks))
    for g in data.gap_explanations:
        db.add(
            VerificationGapExplanation(
                company_id=company.id,
                fiscal_year_id=fy_map.get_required(g.fiscal_year_id),
                series=g.series,
                verification_number=g.verification_number,
                explanation=g.explanation,
                created_by=user_id(g.created_by_email, f"{tag} gap explanation"),
                created_at=_naive(g.created_at),
            )
        )
    report.bump("gap_explanations", len(data.gap_explanations))
    id_maps: dict[str, dict] = {
        "verifications": ver_map,
        "invoices": inv_map,
        "supplier_invoices": sinv_map,
        "expenses": exp_map,
        "accounts": acc_map,
        "fiscal_years": fy_map,
        "customers": cust_map,
        "suppliers": sup_map,
        "companies": {c.id: company.id},
    }
    for a in data.audit_log:
        mapping = id_maps.get(a.table_name)
        db.add(
            AuditLog(
                company_id=company.id,
                user_email=a.user_email,
                action=a.action,
                table_name=a.table_name,
                record_id=(mapping.get(a.record_id) if mapping and a.record_id is not None else None),
                summary=a.summary,
                changes=json.dumps(a.changes, ensure_ascii=False) if a.changes else None,
                created_at=_naive(a.created_at),
            )
        )
    report.bump("audit_log", len(data.audit_log))

    # AI history
    if include_ai and archive.manifest.includes_ai:
        for s in data.chat_sessions:
            uid = user_id(s.user_email, f"{tag} chat session {s.id}", required=True)
            if uid is None:
                report.warnings.append(f"{tag}: chat session {s.id} skipped, no user")
                continue
            obj = ChatSession(
                company_id=company.id,
                user_id=uid,
                title=s.title,
                created_at=_aware(s.created_at),
                updated_at=_aware(s.updated_at),
            )
            db.add(obj)
            db.flush()
            for m in s.messages:
                db.add(
                    ChatMessage(
                        session_id=obj.id,
                        role=m.role,
                        content=m.content,
                        tool_name=m.tool_name,
                        tool_args=m.tool_args,
                        tool_status=m.tool_status,
                        attachment_ids=m.attachment_ids,
                        created_at=_aware(m.created_at),
                    )
                )
            report.bump("chat_sessions")
        for u in data.ai_uploads:
            uid = user_id(u.created_by_email, f"{tag} ai upload {u.id}", required=True)
            if uid is None:
                report.warnings.append(f"{tag}: AI upload {u.id} skipped, no user")
                continue
            member = f"files/{AI_UPLOADS_SUBDIR}/{u.storage_filename}"
            if uploads_target is not None:
                try:
                    _copy_member(zf, member, uploads_target / AI_UPLOADS_SUBDIR / u.storage_filename)
                except KeyError:
                    report.warnings.append(f"{tag}: AI upload {u.original_filename} has no file in archive, skipped")
                    continue
            db.add(
                AIUpload(
                    company_id=company.id,
                    original_filename=u.original_filename,
                    storage_filename=u.storage_filename,
                    mime_type=u.mime_type,
                    size_bytes=u.size_bytes,
                    created_at=_aware(u.created_at),
                    created_by=uid,
                )
            )
            report.bump("ai_uploads")

    db.flush()
    return company.id


# ---------------------------------------------------------------------------
# post-import checks
# ---------------------------------------------------------------------------


def _sie_body(text: str) -> list[str]:
    return [line for line in text.splitlines() if line and not line.startswith(("#GEN", "#PROGRAM"))]


def cross_check_sie(db: Session, archive: ArchiveData, report: ImportReport) -> None:
    """Regenerate SIE4 for every imported fiscal year and compare with the archive copy.

    Differences are reported as warnings: the ledger was inserted verbatim, so a
    mismatch points at the SIE files, not at the import.
    """
    for data, company_id in zip(archive.companies, report.company_ids, strict=True):
        fiscal_years = {fy.label: fy for fy in db.query(FiscalYear).filter(FiscalYear.company_id == company_id).all()}
        for label, expected in data.sie.items():
            fy = fiscal_years.get(label)
            if fy is None:
                continue
            actual = export_sie4(db, company_id, fy.id)
            if _sie_body(actual) != _sie_body(expected):
                report.warnings.append(f"{data.company.org_number}: SIE for {label} differs from archive copy")
