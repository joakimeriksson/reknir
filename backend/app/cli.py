"""
CLI commands for Reknir
Run with: python -m app.cli <command>
"""

import json
import sys
from datetime import UTC, datetime
from pathlib import Path

from app.database import SessionLocal
from app.models import Account, Company
from app.models.account import AccountType
from app.models.posting_template import PostingTemplate, PostingTemplateLine
from app.services.storage import UPLOADS_DIR


def get_seeds_path():
    """
    Get the path to seeds directory, checking multiple locations.

    This function supports both development and Docker environments:
    - Development: Seeds are in /repo/database/seeds (sibling of backend)
    - Docker: Seeds are copied to /app/database/seeds inside the container

    Returns:
        Path: Path to the seeds directory

    Raises:
        FileNotFoundError: If seeds directory is not found in any location
    """
    candidates = [
        Path(__file__).parent.parent.parent / "database" / "seeds",  # Dev: /repo/database/seeds
        Path(__file__).parent.parent / "database" / "seeds",  # Docker: /app/database/seeds
    ]
    for path in candidates:
        if path.exists():
            return path
    raise FileNotFoundError(f"Seeds directory not found. Tried: {[str(p) for p in candidates]}")


def seed_bas_accounts(company_id: int):
    """
    Seed BAS 2024 kontoplan for a company

    Args:
        company_id: Company ID to seed accounts for
    """
    db = SessionLocal()

    try:
        # Check if company exists
        company = db.query(Company).filter(Company.id == company_id).first()
        if not company:
            print(f"Error: Company with ID {company_id} not found")
            print("Please create a company first via the API")
            return False

        # Check if accounts already exist
        existing_count = db.query(Account).filter(Account.company_id == company_id).count()
        if existing_count > 0:
            print(f"Warning: Company {company_id} already has {existing_count} accounts")
            response = input("Do you want to continue and add more accounts? (y/n): ")
            if response.lower() != "y":
                print("Aborted")
                return False

        # Read BAS accounts JSON
        try:
            json_path = get_seeds_path() / "bas_accounts.json"
        except FileNotFoundError as e:
            print(f"Error: {e}")
            return False

        with open(json_path, encoding="utf-8") as f:
            accounts_data = json.load(f)

        # Import accounts
        imported = 0
        skipped = 0

        for acc_data in accounts_data:
            # Check if account already exists
            existing = (
                db.query(Account)
                .filter(Account.company_id == company_id, Account.account_number == acc_data["account_number"])
                .first()
            )

            if existing:
                print(f"  Skipping {acc_data['account_number']} - {acc_data['name']} (already exists)")
                skipped += 1
                continue

            # Create account
            account = Account(
                company_id=company_id,
                account_number=acc_data["account_number"],
                name=acc_data["name"],
                description=acc_data.get("description"),
                account_type=AccountType(acc_data["account_type"]),
                opening_balance=0,
                current_balance=0,
                is_bas_account=True,
                active=True,
            )
            db.add(account)
            imported += 1
            print(f"  ✓ {acc_data['account_number']} - {acc_data['name']}")

        db.commit()

        print(f"\nSuccess! Imported {imported} BAS accounts for company '{company.name}'")
        if skipped > 0:
            print(f"Skipped {skipped} accounts that already existed")

        return True

    except Exception as e:
        db.rollback()
        print(f"Error: {str(e)}")
        import traceback

        traceback.print_exc()
        return False
    finally:
        db.close()


def load_posting_templates():
    """Load posting templates from JSON file"""
    template_file = get_seeds_path() / "posting_templates.json"
    with open(template_file, encoding="utf-8") as f:
        return json.load(f)


def seed_all(company_id: int):
    """
    Seed both BAS accounts and posting templates for a company

    Args:
        company_id: Company ID to seed for
    """
    print(f"Complete setup for company ID {company_id}")
    print("=" * 50)

    # Seed BAS accounts first
    print("1. Seeding BAS kontoplan...")
    bas_success = seed_bas_accounts(company_id)

    if not bas_success:
        print("ERROR: BAS seeding failed, aborting complete setup")
        return False

    print("SUCCESS: BAS kontoplan seeded successfully!")
    print()

    # Seed posting templates
    print("2. Seeding posting templates...")
    template_success = seed_posting_templates(company_id)

    if not template_success:
        print("ERROR: Template seeding failed")
        return False

    print("SUCCESS: Posting templates seeded successfully!")
    print()
    print("Complete setup finished! Your company is ready to use.")
    return True


def seed_posting_templates(company_id: int):
    """
    Seed Swedish posting templates for a company

    Args:
        company_id: Company ID to seed templates for
    """
    db = SessionLocal()

    try:
        # Check if company exists
        company = db.query(Company).filter(Company.id == company_id).first()
        if not company:
            print(f"Error: Company with ID {company_id} not found")
            print("Please create a company first via the API")
            return False

        print(f"Creating posting templates for company '{company.name}'...")

        created = 0
        skipped = 0

        templates = load_posting_templates()

        for template_data in templates:
            # Check if template already exists
            existing = (
                db.query(PostingTemplate)
                .filter(PostingTemplate.company_id == company_id, PostingTemplate.name == template_data["name"])
                .first()
            )

            if existing:
                print(f"  Skipping '{template_data['name']}' (already exists)")
                skipped += 1
                continue

            # Create template
            template = PostingTemplate(
                company_id=company_id,
                name=template_data["name"],
                description=template_data["description"],
                default_series=template_data["default_series"],
                default_journal_text=template_data["default_journal_text"],
            )

            db.add(template)
            db.flush()  # Get template ID

            # Create template lines
            for line_data in template_data["lines"]:
                try:
                    # Verify account exists
                    account_exists = (
                        db.query(Account)
                        .filter(Account.company_id == company_id, Account.account_number == line_data["account_number"])
                        .first()
                    )

                    if not account_exists:
                        print(f"    Warning: Account {line_data['account_number']} not found - skipping line")
                        continue

                    line = PostingTemplateLine(
                        template_id=template.id,
                        account_number=line_data["account_number"],
                        formula=line_data["formula"],
                        description=line_data["description"],
                        sort_order=line_data["sort_order"],
                    )

                    db.add(line)

                except Exception as e:
                    print(f"    Warning: {e} - skipping line")
                    continue

            print(f"  ✓ {template_data['name']}")
            created += 1

        db.commit()

        print(f"\nSuccess! Created {created} posting templates for company '{company.name}'")
        if skipped > 0:
            print(f"Skipped {skipped} templates that already existed")

        return True

    except Exception as e:
        db.rollback()
        print(f"Error: {str(e)}")
        import traceback

        traceback.print_exc()
        return False
    finally:
        db.close()


def main():
    """Main CLI entry point"""
    if len(sys.argv) < 2:
        print("Reknir CLI")
        print("\nUsage: python -m app.cli <command> [args]")
        print("\nCommands:")
        print("  seed-bas [company_id]       - Import BAS 2024 kontoplan for a company")
        print("  seed-templates [company_id] - Import Swedish posting templates for a company")
        print("  seed-all [company_id]       - Import both BAS and templates (complete setup)")
        print("                                Default company_id: 1")
        print("  backup [--json] [--no-ai]   - Create a full system backup (pg_dump + all uploaded files)")
        print("                                --json: portable JSON + files archive instead")
        print("                                --no-ai: leave AI chats and uploads out of a --json archive")
        print("  list-backups                - List available backups")
        print("  verify-backup <path>        - Check a backup archive without restoring it")
        print("  restore <path>              - Restore the whole system from a backup archive")
        print("  export-company <id> [path]  - Export one company as a portable archive")
        print("  import-company <path>       - Import a company archive as a new company")
        print("  bokio-import <dir> [out.zip] [--close-through YEAR] [--user EMAIL]")
        print("                              - Turn a Bokio 'Exportera data' folder into a company archive")
        print("  reset-link <email> [--hours N]")
        print("                              - Print a one-time password reset link for a user (default 24 h)")
        print("  reset-password <email>      - Set a new random password for a user and print it once")
        print("  list-users                  - List user accounts")
        print("\nExamples:")
        print("  python -m app.cli seed-bas")
        print("  python -m app.cli seed-templates")
        print("  python -m app.cli seed-all          # Complete setup")
        print("  python -m app.cli seed-bas 2")
        print("  python -m app.cli seed-templates 2")
        print("  python -m app.cli backup")
        print("  python -m app.cli list-backups")
        print("  python -m app.cli verify-backup /backups/reknir_backup_xxx.tar.gz")
        print("  python -m app.cli restore /backups/reknir_backup_xxx.tar.gz")
        print("  python -m app.cli export-company 1 /backups/exempel-ab.zip")
        print("  python -m app.cli import-company /backups/exempel-ab.zip")
        sys.exit(1)

    command = sys.argv[1]

    if command == "seed-bas":
        # Get company_id from args or default to 1
        company_id = int(sys.argv[2]) if len(sys.argv) > 2 else 1

        print(f"Seeding BAS 2024 kontoplan for company ID {company_id}...")
        print()

        success = seed_bas_accounts(company_id)
        sys.exit(0 if success else 1)

    elif command == "seed-templates":
        # Get company_id from args or default to 1
        company_id = int(sys.argv[2]) if len(sys.argv) > 2 else 1

        print(f"Seeding Swedish posting templates for company ID {company_id}...")
        print()

        success = seed_posting_templates(company_id)
        sys.exit(0 if success else 1)

    elif command == "seed-all":
        # Get company_id from args or default to 1
        company_id = int(sys.argv[2]) if len(sys.argv) > 2 else 1

        success = seed_all(company_id)
        sys.exit(0 if success else 1)

    elif command == "backup":
        from app.services import backup_service

        flags = set(sys.argv[2:])
        print("Creating backup...")
        try:
            if "--json" in flags:
                archive_path = backup_service.create_json_backup(include_ai="--no-ai" not in flags)
            else:
                archive_path = backup_service.create_backup()
            info = backup_service.describe_backup(archive_path)
            print(f"Backup created: {archive_path}")
            if info.get("counts"):
                print(f"Contents: {info['counts']}")
            for warning in info.get("warnings", []):
                print(f"WARNING: {warning}")
        except Exception as e:
            print(f"Backup failed: {e}")
            sys.exit(1)

    elif command == "verify-backup":
        if len(sys.argv) < 3:
            print("Usage: python -m app.cli verify-backup <path-to-backup.tar.gz|.zip>")
            sys.exit(1)
        from app.services import archive_import_service, backup_service

        archive_path = Path(sys.argv[2])
        if archive_path.name.endswith(".tar.gz"):
            try:
                manifest = backup_service.verify_sql_backup(archive_path)
            except Exception as e:
                print(f"INVALID: {e}")
                sys.exit(1)
            print(f"OK: {archive_path.name}")
            print(f"  pg_dump backup, layout {manifest.get('layout', 1)}, created {manifest['created_at']}")
            print(f"  app {manifest['app_version']}, schema {manifest['schema_version']}")
            if "files" in manifest:
                print(f"  {len(manifest['files'])} files verified against their checksums")
            else:
                print("  no checksums in this backup (made before they were added)")
            sys.exit(0)
        try:
            archive = archive_import_service.verify_archive(archive_path)
        except archive_import_service.ArchiveError as e:
            print(f"INVALID: {e}")
            sys.exit(1)
        m = archive.manifest
        print(f"OK: {archive_path.name}")
        print(f"  format {m.format} v{m.format_version}, scope {m.scope}, created {m.created_at.isoformat()}")
        print(
            f"  app {m.app_version}, schema {m.schema_version}, credentials={m.includes_credentials}, ai={m.includes_ai}"
        )
        for c in m.companies:
            print(f"  company: {c.name} ({c.org_number})")
        print(f"  counts: {m.counts}")
        for warning in m.warnings:
            print(f"  WARNING (at export): {warning}")

    elif command == "export-company":
        if len(sys.argv) < 3:
            print("Usage: python -m app.cli export-company <company_id> [output-path]")
            sys.exit(1)
        from app.database import SessionLocal
        from app.services import archive_export_service, backup_service

        company_id = int(sys.argv[2])
        if len(sys.argv) > 3:
            out_path = Path(sys.argv[3])
        else:
            stamp = datetime.now(UTC).strftime("%Y-%m-%d_%H.%M.%S")
            out_path = backup_service.BACKUP_DIR / f"reknir_company_{company_id}_{stamp}.zip"
        db = SessionLocal()
        try:
            manifest = archive_export_service.export_archive(db, out_path, scope="company", company_ids=[company_id])
        finally:
            db.close()
        print(f"Company archive written: {out_path}")
        print(f"Contents: {manifest.counts}")
        for warning in manifest.warnings:
            print(f"WARNING: {warning}")

    elif command == "bokio-import":
        args = [a for a in sys.argv[2:] if not a.startswith("--")]
        if not args:
            print(
                "Usage: python -m app.cli bokio-import <export-dir> [output.zip] [--close-through YEAR] [--user EMAIL]"
            )
            sys.exit(1)
        from app.services import archive_import_service, bokio_import_service

        export_dir = Path(args[0])
        out_path = Path(args[1]) if len(args) > 1 else export_dir / "reknir_company_from_bokio.zip"
        close_through = None
        user_email = None
        for i, a in enumerate(sys.argv):
            if a == "--close-through" and i + 1 < len(sys.argv):
                close_through = int(sys.argv[i + 1])
            if a == "--user" and i + 1 < len(sys.argv):
                user_email = sys.argv[i + 1]
        try:
            report = bokio_import_service.build_archive(
                export_dir, out_path, close_through=close_through, created_by_email=user_email
            )
            archive_import_service.verify_archive(out_path)
        except (bokio_import_service.BokioImportError, archive_import_service.ArchiveError) as e:
            print(f"Failed: {e}")
            sys.exit(1)
        print(f"Archive written and verified: {out_path}")
        print(f"Company: {report.company} ({report.org_number}), fiscal years: {', '.join(report.fiscal_years)}")
        print(f"Counts: {report.counts}")
        print("Reconciliation against Bokio's closing balances:")
        for line in report.checks:
            print(f"  {line}")
        for warning in report.warnings:
            print(f"WARNING: {warning}")
        print("Next: python -m app.cli import-company <archive.zip>")

    elif command == "import-company":
        if len(sys.argv) < 3:
            print("Usage: python -m app.cli import-company <path-to-archive.zip>")
            sys.exit(1)
        from app.database import SessionLocal
        from app.services import archive_import_service

        archive_path = Path(sys.argv[2])
        try:
            archive = archive_import_service.verify_archive(archive_path)
        except archive_import_service.ArchiveError as e:
            print(f"INVALID: {e}")
            sys.exit(1)
        db = SessionLocal()
        try:
            report = archive_import_service.load_archive(db, archive, uploads_target=UPLOADS_DIR, import_users=False)
            db.commit()
            archive_import_service.cross_check_sie(db, archive, report)
        except archive_import_service.ArchiveError as e:
            db.rollback()
            print(f"Import failed: {e}")
            sys.exit(1)
        finally:
            db.close()
        print(f"Imported company id(s): {report.company_ids}")
        print(f"Created: {report.created}")
        for warning in report.warnings:
            print(f"WARNING: {warning}")

    elif command == "list-backups":
        from app.services import backup_service

        backups = backup_service.list_backups()
        if not backups:
            print("No backups found")
        else:
            for b in backups:
                size_mb = b["size_bytes"] / (1024 * 1024)
                print(
                    f"  {b['filename']}  "
                    f"({size_mb:.1f} MB)  "
                    f"created: {b['created_at']}  "
                    f"schema: {b['schema_version']}"
                )

    elif command == "restore":
        if len(sys.argv) < 3:
            print("Usage: python -m app.cli restore <path-to-backup.tar.gz>")
            sys.exit(1)

        archive_path = Path(sys.argv[2])
        if not archive_path.exists():
            print(f"Error: File not found: {archive_path}")
            sys.exit(1)

        from app.services import backup_service

        try:
            info = backup_service.describe_backup(archive_path)
            print(f"Backup: {info['format']} format, created {info['created_at']}, app {info['app_version']}")
            if info.get("companies"):
                print(f"Companies: {', '.join(info['companies'])}")
        except Exception as e:
            print(f"Cannot read backup: {e}")
            sys.exit(1)
        print("WARNING: This will replace ALL current data with the backup.")
        print(f"Archive: {archive_path}")
        response = input("Are you sure? (yes/no): ")
        if response.lower() != "yes":
            print("Aborted")
            sys.exit(0)

        from app.services import restore_service

        try:
            result = restore_service.restore_from_archive(
                archive_path=archive_path,
                performed_by="cli-admin",
            )
            if result.success:
                print("Restore completed successfully!")
                print(f"Backup: {result.backup_filename}")
                print(f"Stages: {', '.join(result.stages_completed)}")
                for warning in result.warnings:
                    print(f"WARNING: {warning}")
            else:
                print(f"Restore failed: {result.message}")
                sys.exit(1)
        except restore_service.RestoreError as e:
            print(f"Restore failed at stage '{e.stage}': {e}")
            sys.exit(1)

    elif command in ("reset-link", "reset-password", "list-users"):
        import os

        from app.models.user import User
        from app.services import auth_service

        db = SessionLocal()
        try:
            if command == "list-users":
                users = db.query(User).filter(User.is_service_account.is_(False)).order_by(User.id).all()
                for u in users:
                    flags = ("admin " if u.is_admin else "") + ("" if u.is_active else "inactive")
                    print(f"{u.id:>3}  {u.email:<40} {u.full_name:<25} {flags}")
                sys.exit(0)

            if len(sys.argv) < 3:
                print(f"Usage: python -m app.cli {command} <email>")
                sys.exit(1)
            email = sys.argv[2]
            user = db.query(User).filter(User.email == email, User.is_service_account.is_(False)).first()
            if not user:
                print(f"No user with email {email}")
                sys.exit(1)

            if command == "reset-link":
                hours = auth_service.PASSWORD_RESET_HOURS
                if "--hours" in sys.argv:
                    hours = int(sys.argv[sys.argv.index("--hours") + 1])
                token, expires_at = auth_service.create_password_reset_token(user, hours=hours)
                path = f"/reset-password/{token}"
                base = os.environ.get("APP_URL", "").rstrip("/")
                print(f"Password reset link for {user.email} (valid until {expires_at:%Y-%m-%d %H:%M} UTC, one use):")
                print(f"  {base}{path}" if base else f"  <your Reknir URL>{path}")
            else:
                new_password = auth_service.generate_password()
                auth_service.set_password(db, user, new_password)
                print(f"New password for {user.email} (shown once, change it after logging in):")
                print(f"  {new_password}")
        finally:
            db.close()

    else:
        print(f"Unknown command: {command}")
        print("Run 'python -m app.cli' to see available commands")
        sys.exit(1)


if __name__ == "__main__":
    main()
