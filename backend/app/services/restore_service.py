"""Restore service for full system restore from backup archives.

Two archive kinds are supported:

- ``reknir_backup_*.tar.gz``: pg_dump + uploaded files (the system backup).
  The dump is restored as it was and the migrations then bring it up to the
  current schema.
- ``reknir_backup_*.zip``: the portable JSON + files archive. Rows are loaded
  through the ORM into a fresh, fully migrated temporary database; files are
  unpacked into a temporary uploads tree.

Both follow the same all-or-nothing flow:

1. Extract / verify the archive
2. Build the new state in a temporary database and a temporary files directory
3. Run bookkeeping validations against it
4. Atomic swap (database rename + upload sub-directory swap)
5. Log the restore event

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
from app.services import archive_import_service, backup_service
from app.services.storage import ATTACHMENTS_DIR, STORAGE_SUBDIRS, UPLOADS_DIR

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
        self.warnings: list[str] = []
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
    return f"postgresql://{db_info['user']}:{db_info['password']}@{db_info['host']}:{db_info['port']}/{dbname}"


def _run_pg_command(cmd: list[str], password: str, timeout: int = 120) -> subprocess.CompletedProcess:
    """Run a PostgreSQL CLI command with PGPASSWORD set."""
    env = {**os.environ, "PGPASSWORD": password}
    return subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=timeout)


# ---------------------------------------------------------------------------
# public entry point
# ---------------------------------------------------------------------------


def restore_from_archive(archive_path: Path, performed_by: str) -> RestoreResult:
    """Full restore from a backup archive of either format.

    Args:
        archive_path: Path to the backup archive (.zip or .tar.gz).
        performed_by: Email/identifier of the admin performing restore.

    Raises:
        RestoreError: If any stage of the restore fails. Production is untouched.
    """
    if archive_path.suffix == ".zip":
        return _restore_json_archive(archive_path, performed_by)
    return _restore_sql_archive(archive_path, performed_by)


# ---------------------------------------------------------------------------
# shared machinery
# ---------------------------------------------------------------------------


class _Names:
    def __init__(self):
        self.db_info = _parse_database_url(settings.database_url)
        self.prod = self.db_info["dbname"]
        self.temp = f"{self.prod}_restore_temp"
        self.old = f"{self.prod}_pre_restore"
        self.maintenance_url = _build_database_url(self.db_info, "postgres")
        self.temp_url = _build_database_url(self.db_info, self.temp)


def _create_temp_database(names: _Names) -> None:
    engine = create_engine(names.maintenance_url, isolation_level="AUTOCOMMIT")
    with engine.connect() as conn:
        conn.execute(text(f"DROP DATABASE IF EXISTS {names.temp}"))
        conn.execute(text(f"CREATE DATABASE {names.temp}"))
    engine.dispose()


def _drop_temp_database(names: _Names) -> None:
    try:
        engine = create_engine(names.maintenance_url, isolation_level="AUTOCOMMIT")
        with engine.connect() as conn:
            conn.execute(text(f"DROP DATABASE IF EXISTS {names.temp}"))
        engine.dispose()
    except Exception:
        pass


def _new_uploads_tree() -> Path:
    temp = Path(tempfile.mkdtemp(prefix="reknir_files_restore_"))
    for sub in STORAGE_SUBDIRS:
        (temp / sub).mkdir()
    return temp


def _swap(names: _Names, temp_files_dir: Path, subdirs: tuple[str, ...]) -> None:
    """Atomic-ish swap: rename databases, then move upload sub-directories into place.

    Only the sub-directories in ``subdirs`` are replaced; the previous contents are
    kept next to them as ``<name>_pre_restore`` until the next restore.
    """
    engine = create_engine(names.maintenance_url, isolation_level="AUTOCOMMIT")
    with engine.connect() as conn:
        conn.execute(
            text(
                f"SELECT pg_terminate_backend(pid) FROM pg_stat_activity "
                f"WHERE datname = '{names.prod}' AND pid <> pg_backend_pid()"
            )
        )
        conn.execute(text(f"DROP DATABASE IF EXISTS {names.old}"))
        conn.execute(text(f"ALTER DATABASE {names.prod} RENAME TO {names.old}"))
        conn.execute(text(f"ALTER DATABASE {names.temp} RENAME TO {names.prod}"))
    engine.dispose()

    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    for sub in subdirs:
        live = UPLOADS_DIR / sub
        previous = UPLOADS_DIR / f"{sub}_pre_restore"
        incoming = temp_files_dir / sub
        if previous.exists():
            shutil.rmtree(previous)
        if live.exists():
            shutil.move(str(live), str(previous))
        shutil.move(str(incoming), str(live))

    # Every pooled connection was just terminated as part of the swap;
    # drop the pool so later requests get fresh connections immediately.
    from app.database import engine as app_engine

    app_engine.dispose()


def _finish(result: RestoreResult, manifest: dict, performed_by: str) -> RestoreResult:
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


# ---------------------------------------------------------------------------
# JSON + files archive
# ---------------------------------------------------------------------------


def _restore_json_archive(archive_path: Path, performed_by: str) -> RestoreResult:
    result = RestoreResult()
    result.backup_filename = archive_path.name
    names = _Names()
    temp_files_dir: Path | None = None
    swapped = False

    try:
        # ---- Stage 1: Verify archive (integrity, format, schema, internal references) ----
        try:
            archive = archive_import_service.verify_archive(archive_path)
        except archive_import_service.ArchiveError as e:
            raise RestoreError(str(e), "verify") from e
        result.stages_completed.append("verify")

        # ---- Stage 2: Scope + version checks ----
        manifest = archive.manifest
        if manifest.scope != "instance":
            raise RestoreError(
                "This is a single-company archive. Use 'import company' instead of a full restore.",
                "version_check",
            )
        if not manifest.includes_credentials:
            result.warnings.append("Archive has no user credentials; every user must reset their password.")
        result.stages_completed.append("version_check")

        # ---- Stage 3: Fresh temporary database at the current schema ----
        _create_temp_database(names)
        result.stages_completed.append("create_temp_db")
        _run_alembic_upgrade(names.temp_url)
        result.stages_completed.append("migrations")

        # ---- Stage 4: Load rows and files ----
        temp_files_dir = _new_uploads_tree()
        engine = create_engine(names.temp_url)
        session = sessionmaker(bind=engine)()
        try:
            # A migrated database already carries the seed rows for ai_settings and
            # backup_schedule; the archive's values are applied on top of them.
            report = archive_import_service.load_archive(
                session, archive, uploads_target=temp_files_dir, import_users=True
            )
            session.commit()
            archive_import_service.cross_check_sie(session, archive, report)
            result.warnings.extend(report.warnings)
        except archive_import_service.ArchiveError as e:
            session.rollback()
            raise RestoreError(str(e), "load") from e
        finally:
            session.close()
            engine.dispose()
        result.stages_completed.append("load")

        # ---- Stage 5: Bookkeeping validations against the temporary database ----
        validation_errors = _run_validations(names.temp_url, temp_files_dir / "attachments")
        if validation_errors:
            raise RestoreError(f"Validation failed: {'; '.join(validation_errors)}", "validation")
        result.stages_completed.append("validation")

        # ---- Stage 6: Atomic swap ----
        _swap(names, temp_files_dir, STORAGE_SUBDIRS)
        swapped = True
        temp_files_dir = None
        result.stages_completed.append("swap")

        return _finish(
            result,
            {
                "app_version": manifest.app_version,
                "schema_version": manifest.schema_version,
                "created_at": manifest.created_at.isoformat(),
            },
            performed_by,
        )

    except RestoreError:
        raise
    except Exception as e:
        raise RestoreError(str(e), "unknown") from e
    finally:
        if temp_files_dir and temp_files_dir.exists():
            shutil.rmtree(temp_files_dir, ignore_errors=True)
        if not swapped:
            _drop_temp_database(names)


# ---------------------------------------------------------------------------
# pg_dump archive
# ---------------------------------------------------------------------------


def _restore_sql_archive(archive_path: Path, performed_by: str) -> RestoreResult:
    result = RestoreResult()
    result.backup_filename = archive_path.name
    names = _Names()
    db_info = names.db_info
    temp_files_dir: Path | None = None
    temp_extract_dir = None
    swapped = False

    try:
        # ---- Stage 1: Read the manifest and verify every member's checksum ----
        try:
            manifest = backup_service.verify_sql_backup(archive_path)
        except (RuntimeError, KeyError, ValueError, OSError, EOFError, tarfile.TarError) as e:
            raise RestoreError(str(e), "verify") from e

        for field in ["created_at", "app_version", "schema_version"]:
            if field not in manifest:
                raise RestoreError(f"Missing required field: {field}", "verify")

        result.stages_completed.append("verify")

        # ---- Stage 2: Extract archive ----
        temp_extract_dir = tempfile.mkdtemp(prefix="reknir_restore_")
        try:
            with tarfile.open(archive_path, "r:gz") as tar:
                # The "data" filter refuses absolute paths, "..", links out of the tree and devices
                tar.extractall(temp_extract_dir, filter="data")
        except tarfile.TarError as e:
            raise RestoreError(str(e), "extract") from e

        result.stages_completed.append("extract")
        backup_dir = Path(temp_extract_dir) / "backup"

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
        _create_temp_database(names)
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
                names.temp,
                "--no-owner",
                "--no-acl",
                str(dump_path),
            ],
            password=db_info["password"],
            timeout=600,
        )

        # pg_restore carries on past errors and then exits non-zero. The one error
        # tolerated is SET transaction_timeout: pg_restore 17 sends it and a
        # PostgreSQL 16 server rejects the setting, which does not affect the data.
        if pg_result.returncode != 0:
            stderr = pg_result.stderr
            unexpected = [
                line
                for line in stderr.splitlines()
                if line.startswith("pg_restore: error:") and "transaction_timeout" not in line
            ]
            if unexpected or "errors ignored on restore" not in stderr:
                raise RestoreError(f"pg_restore failed: {stderr}", "restore_db")
            logger.warning(f"pg_restore skipped SET transaction_timeout: {stderr}")

        result.stages_completed.append("restore_db")

        # ---- Stage 6: Restore files to temp directory ----
        temp_files_dir = _new_uploads_tree()
        if manifest.get("layout", 1) >= 2:
            for sub in STORAGE_SUBDIRS:
                source = backup_dir / "uploads" / sub
                if source.is_dir():
                    (temp_files_dir / sub).rmdir()
                    shutil.move(str(source), str(temp_files_dir / sub))
            restored_subdirs = STORAGE_SUBDIRS
        else:
            # Layout 1 holds the attachments only, directly under backup/files
            files_source = backup_dir / "files"
            if files_source.exists():
                for item in files_source.iterdir():
                    dest = temp_files_dir / "attachments" / item.name
                    if item.is_file():
                        shutil.copy2(item, dest)
                    elif item.is_dir():
                        shutil.copytree(item, dest)
            restored_subdirs = ("attachments",)

        result.stages_completed.append("restore_files")

        # ---- Stage 7: Run migrations ----
        # Always run alembic upgrade to ensure the restored database has all
        # current migrations applied. Alembic reads alembic_version from the
        # restored DB and only runs what's missing — a no-op if already at head.
        _run_alembic_upgrade(names.temp_url)

        result.stages_completed.append("migrations")

        # ---- Stage 8: Run bookkeeping validations ----
        validation_errors = _run_validations(names.temp_url, temp_files_dir / "attachments")

        if validation_errors:
            raise RestoreError(
                f"Validation failed: {'; '.join(validation_errors)}",
                "validation",
            )

        result.stages_completed.append("validation")

        # ---- Stage 9: Atomic swap (layout 1 replaces the attachments only) ----
        _swap(names, temp_files_dir, restored_subdirs)
        swapped = True
        result.stages_completed.append("swap")

        # ---- Stage 10: Log restore event ----
        return _finish(result, manifest, performed_by)

    except RestoreError:
        raise
    except Exception as e:
        raise RestoreError(str(e), "unknown") from e
    finally:
        # Cleanup temp resources on failure
        if temp_extract_dir and Path(temp_extract_dir).exists():
            shutil.rmtree(temp_extract_dir, ignore_errors=True)
        if temp_files_dir and temp_files_dir.exists():
            shutil.rmtree(temp_files_dir, ignore_errors=True)
        if not swapped:
            _drop_temp_database(names)


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

    Args:
        database_url: The (temporary) database to check.
        files_dir: The attachments directory the database's rows must match.

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
            errors.append(f"{len(missing_files)} attachment file(s) missing from backup: {missing_files[:5]}")

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


# Re-exported for callers that only need the attachments location.
__all__ = ["RestoreError", "RestoreResult", "restore_from_archive", "ATTACHMENTS_DIR"]
