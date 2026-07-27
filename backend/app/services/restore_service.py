"""Restore service for full system restore from backup archives.

Restore flow (all-or-nothing):
1. Extract archive to temp directory
2. Read and validate manifest
3. Check version compatibility
4. Create temporary database
5. Restore pg_dump to temp database
6. Restore files to temp directory
7. Run Alembic migrations if needed
8. Run bookkeeping validations
9. Atomic swap (database rename + file directory swap)
10. Log the restore event

If any step fails, production remains untouched.
"""

import json
import logging
import os
import shutil
import subprocess
import tarfile
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlparse

from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.config import settings
from app.schema_version import CURRENT_SCHEMA_VERSION
from app.services.attachment_service import ATTACHMENTS_DIR

logger = logging.getLogger(__name__)


class RestoreError(Exception):
    """Raised when restore fails at any stage."""

    def __init__(self, message: str, stage: str):
        self.stage = stage
        super().__init__(f"Restore failed at stage '{stage}': {message}")


class RestoreResult:
    """Result object for a restore operation."""

    def __init__(self):
        self.success: bool = False
        self.backup_filename: str = ""
        self.message: str = ""
        self.stages_completed: list[str] = []
        self.started_at: datetime = datetime.now(UTC)
        self.completed_at: datetime | None = None


def _parse_database_url(url: str) -> dict:
    """Parse DATABASE_URL into components for pg_dump/pg_restore."""
    parsed = urlparse(url)
    return {
        "host": parsed.hostname or "localhost",
        "port": str(parsed.port or 5432),
        "user": parsed.username or "reknir",
        "password": parsed.password or "",
        "dbname": (parsed.path or "/reknir").lstrip("/"),
    }


def _build_database_url(db_info: dict, dbname: str) -> str:
    """Build a PostgreSQL connection URL from components."""
    return f"postgresql://{db_info['user']}:{db_info['password']}" f"@{db_info['host']}:{db_info['port']}/{dbname}"


def _run_pg_command(cmd: list[str], password: str, timeout: int = 120) -> subprocess.CompletedProcess:
    """Run a PostgreSQL CLI command with PGPASSWORD set."""
    env = {**os.environ, "PGPASSWORD": password}
    return subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=timeout)


def restore_from_archive(archive_path: Path, performed_by: str) -> RestoreResult:
    """Full restore flow: extract, validate, restore to temp, validate data, atomic swap.

    Args:
        archive_path: Path to the .tar.gz backup archive.
        performed_by: Email/identifier of the admin performing restore.

    Returns:
        RestoreResult with success status and details.

    Raises:
        RestoreError: If any stage of the restore fails.
    """
    result = RestoreResult()
    db_info = _parse_database_url(settings.database_url)
    prod_dbname = db_info["dbname"]
    temp_dbname = f"{prod_dbname}_restore_temp"
    old_dbname = f"{prod_dbname}_pre_restore"
    temp_files_dir = None
    temp_extract_dir = None

    try:
        # ---- Stage 1: Extract archive ----
        temp_extract_dir = tempfile.mkdtemp(prefix="reknir_restore_")

        with tarfile.open(archive_path, "r:gz") as tar:
            # Security: validate member paths to prevent path traversal
            for member in tar.getmembers():
                if member.name.startswith("/") or ".." in member.name:
                    raise RestoreError("Archive contains unsafe paths", "extract")
            tar.extractall(temp_extract_dir)

        result.stages_completed.append("extract")
        backup_dir = Path(temp_extract_dir) / "backup"

        # ---- Stage 2: Read and validate manifest ----
        manifest_path = backup_dir / "manifest.json"
        if not manifest_path.exists():
            raise RestoreError("No manifest.json found in backup", "read_manifest")

        with open(manifest_path) as f:
            manifest = json.load(f)

        result.backup_filename = archive_path.name

        for field in ["created_at", "app_version", "schema_version"]:
            if field not in manifest:
                raise RestoreError(f"Missing required field: {field}", "read_manifest")

        result.stages_completed.append("read_manifest")

        # ---- Stage 3: Version compatibility check ----
        backup_schema = manifest["schema_version"]

        if backup_schema > CURRENT_SCHEMA_VERSION:
            raise RestoreError(
                f"Backup schema version ({backup_schema}) is newer than "
                f"current application schema ({CURRENT_SCHEMA_VERSION}). "
                f"Upgrade the application first.",
                "version_check",
            )

        result.stages_completed.append("version_check")

        # ---- Stage 4: Create temporary database ----
        maintenance_url = _build_database_url(db_info, "postgres")
        maint_engine = create_engine(maintenance_url, isolation_level="AUTOCOMMIT")

        with maint_engine.connect() as conn:
            conn.execute(text(f"DROP DATABASE IF EXISTS {temp_dbname}"))
            conn.execute(text(f"CREATE DATABASE {temp_dbname}"))

        maint_engine.dispose()
        result.stages_completed.append("create_temp_db")

        # ---- Stage 5: Restore pg_dump to temp database ----
        dump_path = backup_dir / "database_dump"
        if not dump_path.exists():
            raise RestoreError("No database_dump found in backup", "restore_db")

        pg_result = _run_pg_command(
            [
                "pg_restore",
                "-h",
                db_info["host"],
                "-p",
                db_info["port"],
                "-U",
                db_info["user"],
                "-d",
                temp_dbname,
                "--no-owner",
                "--no-acl",
                str(dump_path),
            ],
            password=db_info["password"],
            timeout=600,
        )

        # pg_restore returns non-zero for both fatal errors and non-fatal warnings
        # (e.g. SET transaction_timeout from newer pg_dump versions).
        # If it reports "errors ignored on restore" it means it continued past them.
        # Only fail on truly fatal issues where pg_restore couldn't proceed at all.
        if pg_result.returncode != 0:
            stderr = pg_result.stderr
            has_ignored_errors = "errors ignored on restore" in stderr
            if not has_ignored_errors:
                # Fatal error - pg_restore couldn't even partially complete
                raise RestoreError(f"pg_restore failed: {stderr}", "restore_db")
            else:
                logger.warning(f"pg_restore completed with non-fatal warnings: {stderr}")

        result.stages_completed.append("restore_db")

        # ---- Stage 6: Restore files to temp directory ----
        files_source = backup_dir / "files"
        temp_files_dir = tempfile.mkdtemp(prefix="reknir_files_restore_")

        if files_source.exists():
            for item in files_source.iterdir():
                dest = Path(temp_files_dir) / item.name
                if item.is_file():
                    shutil.copy2(item, dest)
                elif item.is_dir():
                    shutil.copytree(item, dest)

        result.stages_completed.append("restore_files")

        # ---- Stage 7: Run migrations ----
        # Always run alembic upgrade to ensure the restored database has all
        # current migrations applied. Alembic reads alembic_version from the
        # restored DB and only runs what's missing — a no-op if already at head.
        temp_db_url = _build_database_url(db_info, temp_dbname)
        _run_alembic_upgrade(temp_db_url)

        result.stages_completed.append("migrations")

        # ---- Stage 8: Run bookkeeping validations ----
        temp_db_url = _build_database_url(db_info, temp_dbname)
        validation_errors = _run_validations(temp_db_url, Path(temp_files_dir))

        if validation_errors:
            raise RestoreError(
                f"Validation failed: {'; '.join(validation_errors)}",
                "validation",
            )

        result.stages_completed.append("validation")

        # ---- Stage 9: Atomic swap ----
        # 9a: Terminate all connections to production DB
        maint_engine = create_engine(maintenance_url, isolation_level="AUTOCOMMIT")

        with maint_engine.connect() as conn:
            conn.execute(
                text(
                    f"SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                    f"WHERE datname = '{prod_dbname}' AND pid <> pg_backend_pid()"
                )
            )

            # 9b: Rename production -> old, temp -> production
            conn.execute(text(f"DROP DATABASE IF EXISTS {old_dbname}"))
            conn.execute(text(f"ALTER DATABASE {prod_dbname} RENAME TO {old_dbname}"))
            conn.execute(text(f"ALTER DATABASE {temp_dbname} RENAME TO {prod_dbname}"))

        maint_engine.dispose()

        # 9c: Swap file directories
        old_attachments = ATTACHMENTS_DIR.parent / "attachments_pre_restore"

        if old_attachments.exists():
            shutil.rmtree(old_attachments)

        if ATTACHMENTS_DIR.exists():
            shutil.move(str(ATTACHMENTS_DIR), str(old_attachments))

        shutil.move(temp_files_dir, str(ATTACHMENTS_DIR))
        temp_files_dir = None  # Prevent cleanup since it's now in place

        result.stages_completed.append("swap")

        # Every pooled connection was just terminated as part of the swap;
        # drop the pool so later requests get fresh connections immediately.
        from app.database import engine as app_engine

        app_engine.dispose()

        # ---- Stage 10: Log restore event ----
        _log_restore_event(
            backup_filename=result.backup_filename,
            performed_by=performed_by,
            success=True,
            message="Restore completed successfully",
            manifest=manifest,
        )

        result.success = True
        result.message = "Restore completed successfully"
        result.completed_at = datetime.now(UTC)

        return result

    except RestoreError:
        raise
    except Exception as e:
        raise RestoreError(str(e), "unknown") from e
    finally:
        # Cleanup temp resources on failure
        if temp_extract_dir and Path(temp_extract_dir).exists():
            shutil.rmtree(temp_extract_dir, ignore_errors=True)
        if temp_files_dir and Path(temp_files_dir).exists():
            shutil.rmtree(temp_files_dir, ignore_errors=True)

        # Drop temp DB if it still exists (means swap didn't happen)
        try:
            maintenance_url = _build_database_url(db_info, "postgres")
            cleanup_engine = create_engine(maintenance_url, isolation_level="AUTOCOMMIT")
            with cleanup_engine.connect() as conn:
                conn.execute(text(f"DROP DATABASE IF EXISTS {temp_dbname}"))
            cleanup_engine.dispose()
        except Exception:
            pass


def _run_alembic_upgrade(database_url: str) -> None:
    """Run Alembic migrations programmatically against a given database URL."""
    from pathlib import Path as P

    from alembic import command
    from alembic.config import Config

    alembic_cfg = Config()
    alembic_cfg.set_main_option("script_location", str(P(__file__).parent.parent.parent / "alembic"))
    alembic_cfg.set_main_option("sqlalchemy.url", database_url)

    command.upgrade(alembic_cfg, "head")


def _run_validations(database_url: str, files_dir: Path) -> list[str]:
    """Run bookkeeping validations against the restored database.

    Returns:
        List of error messages. Empty list means all validations passed.
    """
    errors = []
    engine = create_engine(database_url)
    Session = sessionmaker(bind=engine)
    session = Session()

    try:
        # Validation 1: Total debit == total credit
        row = session.execute(
            text(
                "SELECT COALESCE(SUM(debit), 0) as total_debit, "
                "COALESCE(SUM(credit), 0) as total_credit "
                "FROM transaction_lines"
            )
        ).fetchone()

        if row:
            total_debit, total_credit = row[0], row[1]
            if abs(float(total_debit) - float(total_credit)) > 0.01:
                errors.append(f"Debit/credit mismatch: debit={total_debit}, credit={total_credit}")

        # Validation 2: Per-verification balance check
        unbalanced = session.execute(
            text(
                "SELECT v.id, v.series, v.verification_number, "
                "SUM(tl.debit) as total_debit, SUM(tl.credit) as total_credit "
                "FROM verifications v "
                "JOIN transaction_lines tl ON tl.verification_id = v.id "
                "GROUP BY v.id, v.series, v.verification_number "
                "HAVING ABS(SUM(tl.debit) - SUM(tl.credit)) > 0.01"
            )
        ).fetchall()

        if unbalanced:
            samples = [f"{r[1]}{r[2]}" for r in unbalanced[:5]]
            errors.append(f"{len(unbalanced)} unbalanced verification(s): {samples}")

        # Validation 3: All attachment file references have corresponding files
        attachments = session.execute(text("SELECT id, storage_filename FROM attachments")).fetchall()

        missing_files = []
        for att in attachments:
            file_path = files_dir / att[1]
            if not file_path.exists():
                missing_files.append(att[1])

        if missing_files:
            errors.append(f"{len(missing_files)} attachment file(s) missing from backup: " f"{missing_files[:5]}")

        # Validation 4: Referential integrity - transaction_lines -> accounts
        orphan_lines = session.execute(
            text(
                "SELECT COUNT(*) FROM transaction_lines tl "
                "LEFT JOIN accounts a ON tl.account_id = a.id "
                "WHERE a.id IS NULL"
            )
        ).scalar()

        if orphan_lines and orphan_lines > 0:
            errors.append(f"{orphan_lines} transaction line(s) reference non-existent accounts")

        # Validation 5: Referential integrity - verifications -> companies
        orphan_verifications = session.execute(
            text(
                "SELECT COUNT(*) FROM verifications v "
                "LEFT JOIN companies c ON v.company_id = c.id "
                "WHERE c.id IS NULL"
            )
        ).scalar()

        if orphan_verifications and orphan_verifications > 0:
            errors.append(f"{orphan_verifications} verification(s) reference non-existent companies")

    finally:
        session.close()
        engine.dispose()

    return errors


def _log_restore_event(
    backup_filename: str,
    performed_by: str,
    success: bool,
    message: str,
    manifest: dict | None = None,
) -> None:
    """Log a restore event to both the application log and the restore_log table."""
    log_entry = {
        "timestamp": datetime.now(UTC).isoformat(),
        "backup_filename": backup_filename,
        "performed_by": performed_by,
        "success": success,
        "message": message,
        "backup_app_version": manifest.get("app_version") if manifest else None,
        "backup_schema_version": manifest.get("schema_version") if manifest else None,
        "backup_created_at": manifest.get("created_at") if manifest else None,
    }

    if success:
        logger.info(f"RESTORE_EVENT: {json.dumps(log_entry)}")
    else:
        logger.error(f"RESTORE_EVENT: {json.dumps(log_entry)}")

    # Persist to the restored database
    try:
        db_info = _parse_database_url(settings.database_url)
        db_url = _build_database_url(db_info, db_info["dbname"])
        log_engine = create_engine(db_url)

        with log_engine.connect() as conn:
            conn.execute(
                text(
                    "INSERT INTO restore_log "
                    "(backup_filename, performed_by, success, message, "
                    " backup_app_version, backup_schema_version, created_at) "
                    "VALUES (:backup_filename, :performed_by, :success, :message, "
                    " :app_version, :schema_version, NOW())"
                ),
                {
                    "backup_filename": backup_filename,
                    "performed_by": performed_by,
                    "success": success,
                    "message": message,
                    "app_version": manifest.get("app_version") if manifest else None,
                    "schema_version": (manifest.get("schema_version") if manifest else None),
                },
            )
            conn.commit()

        log_engine.dispose()
    except Exception as e:
        logger.warning(f"Could not persist restore log to database: {e}")
