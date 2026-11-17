"""Tests for the pg_dump system backup's manifest and checksums.

pg_dump itself needs PostgreSQL, so it is replaced by a fake dump here; the
archive layout, the manifest and the verification are what is under test.
"""

import hashlib
import io
import json
import tarfile
from pathlib import Path

import pytest

from app.services import backup_service


@pytest.fixture
def backup_env(tmp_path, monkeypatch):
    uploads = tmp_path / "uploads"
    for name, data in [
        ("attachments/aaaa-receipt.pdf", b"%PDF receipt"),
        ("attachments/2026/bbbb-nested.pdf", b"%PDF nested"),
        ("logos/logo.png", b"PNG logo"),
        ("ai_uploads/cccc-scan.png", b"scan"),
    ]:
        (uploads / name).parent.mkdir(parents=True, exist_ok=True)
        (uploads / name).write_bytes(data)
    monkeypatch.setattr(backup_service, "UPLOADS_DIR", uploads)
    monkeypatch.setattr(backup_service, "BACKUP_DIR", tmp_path / "backups")
    monkeypatch.setattr(backup_service, "_pg_dump", lambda path: path.write_bytes(b"PGDMP fake dump"))
    monkeypatch.setattr(backup_service, "get_applied_schema_version", lambda: "032")
    return tmp_path


def _rewrite(archive: Path, out: Path, *, replace=None, drop=None, add=None) -> Path:
    """Copy a backup archive, optionally replacing, dropping or adding a member."""
    with tarfile.open(archive, "r:gz") as src, tarfile.open(out, "w:gz") as dst:
        for member in src:
            if member.name == drop:
                continue
            data = src.extractfile(member).read() if member.isfile() else None
            if member.name == replace:
                data = b"altered" + data[7:]
            dst.addfile(member, io.BytesIO(data) if data is not None else None)
        if add:
            info = tarfile.TarInfo(add)
            info.size = 5
            dst.addfile(info, io.BytesIO(b"extra"))
    return out


def test_create_backup_archives_every_upload_with_checksums(backup_env):
    archive = backup_service.create_backup()

    assert archive.name.startswith("reknir_backup_") and archive.name.endswith(".tar.gz")
    assert not list(archive.parent.glob("*.partial"))
    with tarfile.open(archive, "r:gz") as tar:
        names = tar.getnames()
        manifest = json.loads(tar.extractfile("backup/manifest.json").read())
        for entry in manifest["files"]:
            data = tar.extractfile(f"backup/{entry['path']}").read()
            assert entry["bytes"] == len(data)
            assert entry["sha256"] == hashlib.sha256(data).hexdigest()

    assert names[0] == "backup/manifest.json"
    assert manifest["layout"] == 2
    assert manifest["schema_version"] == "032"
    assert [e["path"] for e in manifest["files"]] == [
        "database_dump",
        "uploads/attachments/2026/bbbb-nested.pdf",
        "uploads/attachments/aaaa-receipt.pdf",
        "uploads/logos/logo.png",
        "uploads/ai_uploads/cccc-scan.png",
    ]
    assert backup_service.verify_sql_backup(archive) == manifest


def test_describe_backup_leaves_out_the_file_list(backup_env):
    info = backup_service.describe_backup(backup_service.create_backup())

    assert info["format"] == "sql"
    assert info["schema_version"] == "032"
    assert "files" not in info


def test_failed_pg_dump_leaves_no_archive(backup_env, monkeypatch):
    def failing_dump(path):
        raise RuntimeError("pg_dump failed: connection refused")

    monkeypatch.setattr(backup_service, "_pg_dump", failing_dump)
    with pytest.raises(RuntimeError, match="pg_dump failed"):
        backup_service.create_backup()
    assert not list((backup_env / "backups").iterdir())


def test_verify_rejects_an_altered_file(backup_env):
    archive = backup_service.create_backup()
    bad = _rewrite(archive, backup_env / "altered.tar.gz", replace="backup/uploads/logos/logo.png")

    with pytest.raises(RuntimeError, match="does not match its checksum"):
        backup_service.verify_sql_backup(bad)


def test_verify_rejects_a_missing_file(backup_env):
    archive = backup_service.create_backup()
    bad = _rewrite(archive, backup_env / "missing.tar.gz", drop="backup/uploads/ai_uploads/cccc-scan.png")

    with pytest.raises(RuntimeError, match="missing 1 file"):
        backup_service.verify_sql_backup(bad)


def test_verify_rejects_an_unlisted_file(backup_env):
    archive = backup_service.create_backup()
    bad = _rewrite(archive, backup_env / "extra.tar.gz", add="backup/uploads/attachments/smuggled.pdf")

    with pytest.raises(RuntimeError, match="not listed in the manifest"):
        backup_service.verify_sql_backup(bad)


def test_verify_accepts_a_layout_1_backup_without_checksums(tmp_path):
    manifest = {"created_at": "2026-09-01T00:00:00+00:00", "app_version": "1.3.3", "schema_version": "029"}
    archive = tmp_path / "reknir_backup_2026-09-01_00.00.00.tar.gz"
    with tarfile.open(archive, "w:gz") as tar:
        for name, data in [
            ("backup/manifest.json", json.dumps(manifest).encode()),
            ("backup/database_dump", b"PGDMP old dump"),
            ("backup/files/aaaa-receipt.pdf", b"%PDF receipt"),
        ]:
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))

    assert backup_service.verify_sql_backup(archive) == manifest
    assert backup_service.describe_backup(archive)["format"] == "sql"
