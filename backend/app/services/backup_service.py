"""Backup service for creating and listing full system backups.

A system backup (``reknir_backup_*.tar.gz``) is a pg_dump of the whole database
plus every uploads sub-directory (attachments, logos, AI uploads) and a manifest
with the Alembic revision and the size and SHA-256 of every member. A restore
loads the dump as it was and then runs the migrations on it, so a backup from an
older Reknir restores into any newer one, and tables added later are included
without changes here.

``create_json_backup`` produces the portable JSON + files archive
(``reknir_backup_*.zip``, see docs/PORTABLE_ARCHIVE.md) for moving or archiving
data outside Reknir; ``restore_service`` restores both kinds.
"""

import hashlib
import json
import logging
import os
import subprocess
import tarfile
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlparse

from app import __version__
from app.config import settings
from app.schema_version import get_applied_schema_version
from app.services import archive_export_service, archive_import_service
from app.services.storage import STORAGE_SUBDIRS, UPLOADS_DIR

logger = logging.getLogger(__name__)

BACKUP_DIR = Path(settings.backup_dir)
BACKUP_PATTERNS = ("reknir_backup_*.zip", "reknir_backup_*.tar.gz")

# 1: backup/files holds the attachments only. 2: backup/uploads/<sub> for every
# storage sub-directory, and manifest["files"] lists every member with its checksum.
SQL_BACKUP_LAYOUT = 2
MANIFEST_MEMBER = "backup/manifest.json"


def is_backup_filename(filename: str) -> bool:
    import fnmatch

    return any(fnmatch.fnmatch(filename, pattern) for pattern in BACKUP_PATTERNS)


def _all_archives() -> list[Path]:
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    found: list[Path] = []
    for pattern in BACKUP_PATTERNS:
        found.extend(BACKUP_DIR.glob(pattern))
    return sorted(found)


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


def _sha256_stream(f) -> str:
    digest = hashlib.sha256()
    for chunk in iter(lambda: f.read(1024 * 1024), b""):
        digest.update(chunk)
    return digest.hexdigest()


def _sha256_file(path: Path) -> str:
    with open(path, "rb") as f:
        return _sha256_stream(f)


def _upload_members() -> list[tuple[str, Path]]:
    """Every stored file as (path inside backup/, path on disk), in a stable order."""
    members = []
    for sub in STORAGE_SUBDIRS:
        root = UPLOADS_DIR / sub
        if not root.is_dir():
            continue
        for path in sorted(p for p in root.rglob("*") if p.is_file()):
            members.append((f"uploads/{sub}/{path.relative_to(root).as_posix()}", path))
    return members


def _pg_dump(dump_path: Path) -> None:
    db_info = _parse_database_url(settings.database_url)
    result = subprocess.run(
        [
            "pg_dump",
            "-h",
            db_info["host"],
            "-p",
            db_info["port"],
            "-U",
            db_info["user"],
            "-Fc",
            "-f",
            str(dump_path),
            db_info["dbname"],
        ],
        env={**os.environ, "PGPASSWORD": db_info["password"]},
        capture_output=True,
        text=True,
        timeout=600,
    )
    if result.returncode != 0:
        raise RuntimeError(f"pg_dump failed: {result.stderr}")


def create_backup() -> Path:
    """Create a full system backup: pg_dump + every uploaded file, as a tar.gz.

    Only the files listed in the manifest are archived, so a file uploaded while
    the backup runs is either fully included or not at all.

    Returns:
        Path to the created backup archive.

    Raises:
        RuntimeError: If pg_dump fails.
    """
    now = datetime.now(UTC)
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    archive_path = BACKUP_DIR / f"reknir_backup_{now.strftime('%Y-%m-%d_%H.%M.%S')}.tar.gz"
    partial_path = archive_path.with_name(archive_path.name + ".partial")

    with tempfile.TemporaryDirectory(prefix="reknir_backup_") as tmp_dir:
        dump_path = Path(tmp_dir) / "database_dump"
        _pg_dump(dump_path)

        members = [("database_dump", dump_path), *_upload_members()]
        manifest = {
            "created_at": now.isoformat(),
            "app_version": __version__,
            "schema_version": get_applied_schema_version(),
            "layout": SQL_BACKUP_LAYOUT,
            "files": [
                {"path": name, "bytes": path.stat().st_size, "sha256": _sha256_file(path)} for name, path in members
            ],
        }
        manifest_path = Path(tmp_dir) / "manifest.json"
        manifest_path.write_text(json.dumps(manifest, indent=2))

        try:
            # The manifest goes first so that listing backups never has to read past it
            with tarfile.open(partial_path, "w:gz") as tar:
                tar.add(str(manifest_path), arcname=MANIFEST_MEMBER)
                for name, path in members:
                    tar.add(str(path), arcname=f"backup/{name}")
        except Exception:
            partial_path.unlink(missing_ok=True)
            raise

    partial_path.replace(archive_path)
    logger.info(f"Backup created: {archive_path}")
    return archive_path


def read_sql_manifest(archive_path: Path) -> dict:
    """Read manifest.json from a tar.gz backup without decompressing the rest."""
    with tarfile.open(archive_path, "r:gz") as tar:
        for member in tar:
            if member.name == MANIFEST_MEMBER:
                f = tar.extractfile(member)
                if f is None:
                    break
                return json.loads(f.read())
    raise RuntimeError(f"{archive_path.name} has no readable {MANIFEST_MEMBER}")


def verify_sql_backup(archive_path: Path) -> dict:
    """Check every member of a tar.gz backup against the manifest checksums.

    Backups from before the checksums were added (layout 1) are only checked for
    a readable manifest.

    Returns:
        The manifest.

    Raises:
        RuntimeError: On a missing, altered or unlisted member.
    """
    manifest = read_sql_manifest(archive_path)
    if manifest.get("layout", 1) < 2:
        return manifest

    expected = {f"backup/{entry['path']}": entry for entry in manifest["files"]}
    seen = set()
    with tarfile.open(archive_path, "r:gz") as tar:
        for member in tar:
            if member.name == MANIFEST_MEMBER or member.isdir():
                continue
            if not member.isfile():
                raise RuntimeError(f"{member.name} is not a regular file")
            entry = expected.get(member.name)
            if entry is None:
                raise RuntimeError(f"{member.name} is not listed in the manifest")
            if member.size != entry["bytes"] or _sha256_stream(tar.extractfile(member)) != entry["sha256"]:
                raise RuntimeError(f"{member.name} does not match its checksum")
            seen.add(member.name)

    missing = sorted(set(expected) - seen)
    if missing:
        raise RuntimeError(f"Backup is missing {len(missing)} file(s), e.g. {missing[0]}")
    return manifest


def create_json_backup(include_ai: bool = True) -> Path:
    """Create a full backup as a portable JSON + files archive (.zip).

    Returns:
        Path to the created backup archive.
    """
    from app.database import SessionLocal

    now = datetime.now(UTC)
    timestamp_label = now.strftime("%Y-%m-%d_%H.%M.%S")
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    archive_path = BACKUP_DIR / f"reknir_backup_{timestamp_label}.zip"
    partial_path = archive_path.with_suffix(".zip.partial")

    db = SessionLocal()
    try:
        manifest = archive_export_service.export_archive(db, partial_path, scope="instance", include_ai=include_ai)
    except Exception:
        partial_path.unlink(missing_ok=True)
        raise
    finally:
        db.close()

    partial_path.replace(archive_path)
    if manifest.warnings:
        logger.warning(f"Backup created with {len(manifest.warnings)} warning(s): {archive_path}")
    logger.info(f"Backup created: {archive_path}")
    return archive_path


def enforce_retention(max_backups: int) -> int:
    """Delete oldest backup archives if count exceeds max_backups.

    Returns:
        Number of backups deleted.
    """
    archives = _all_archives()
    deleted = 0
    while len(archives) > max_backups:
        oldest = archives.pop(0)
        oldest.unlink()
        logger.info(f"Retention: deleted {oldest.name}")
        deleted += 1
    return deleted


def list_backups() -> list[dict]:
    """List all available backup archives with their manifest metadata.

    Returns:
        List of dicts with created_at, app_version, schema_version, format
        ("json" or "sql"), filename, size_bytes, and for json archives also
        companies, counts and warnings.
    """
    backups = []

    for archive_path in reversed(_all_archives()):
        try:
            backups.append(describe_backup(archive_path))
        except Exception as e:
            logger.warning(f"Could not read manifest from {archive_path}: {e}")

    return backups


def describe_backup(archive_path: Path) -> dict:
    """Read the manifest of one backup archive (either format)."""
    if archive_path.suffix == ".zip":
        manifest = archive_import_service.read_manifest(archive_path)
        info = {
            "created_at": manifest.created_at.isoformat(),
            "app_version": manifest.app_version,
            "schema_version": manifest.schema_version,
            "format": "json",
            "format_version": manifest.format_version,
            "scope": manifest.scope,
            "companies": [c.name for c in manifest.companies],
            "counts": manifest.counts,
            "warnings": manifest.warnings,
        }
    else:
        info = read_sql_manifest(archive_path)
        info.pop("files", None)
        info["format"] = "sql"
    info["filename"] = archive_path.name
    info["size_bytes"] = archive_path.stat().st_size
    return info
