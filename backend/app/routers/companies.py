import json
import os
import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_active_user, get_user_company_ids, verify_company_access
from app.models.account import Account
from app.models.company import Company, PaymentType
from app.models.compliance import PeriodLock
from app.models.default_account import DefaultAccount
from app.models.fiscal_year import FiscalYear
from app.models.user import CompanyUser, User
from app.models.verification import Verification
from app.schemas.company import CompanyCreate, CompanyResponse, CompanyUpdate
from app.schemas.compliance import PeriodLockCreate, PeriodLockResponse, PeriodLockStatus
from app.services import company_service, deadline_service, default_account_service, ledger_service
from app.services.storage import LOGOS_DIR

router = APIRouter()


@router.post("/", response_model=CompanyResponse, status_code=status.HTTP_201_CREATED)
def create_company(
    company: CompanyCreate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Create a new company"""

    # Check if org_number already exists
    existing = db.query(Company).filter(Company.org_number == company.org_number).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Company with org number {company.org_number} already exists",
        )

    # Validate payment_type and required fields
    if company.payment_type:
        if company.payment_type == PaymentType.BANKGIRO and not company.bankgiro_number:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Bankgironummer krävs för betalningstyp Bankgiro.",
            )
        elif company.payment_type == PaymentType.PLUSGIRO and not company.plusgiro_number:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Plusgironummer krävs för betalningstyp Plusgiro.",
            )
        elif company.payment_type == PaymentType.BANK_ACCOUNT:
            if not company.clearing_number or not company.account_number:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Clearingnummer och kontonummer krävs för betalningstyp Bankkonto.",
                )

    # Create company
    db_company = Company(**company.model_dump())
    db.add(db_company)
    db.commit()
    db.refresh(db_company)

    # Auto-grant access to creator (if not admin)
    # Admins have access to all companies by default, but we can still add them for explicit tracking
    if not current_user.is_admin:
        company_user = CompanyUser(
            company_id=db_company.id,
            user_id=current_user.id,
            role="accountant",
            created_by=current_user.id,
        )
        db.add(company_user)
        db.commit()

    return db_company


@router.get("/", response_model=list[CompanyResponse])
def list_companies(
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """List companies user has access to"""
    # Get company IDs user has access to
    company_ids = get_user_company_ids(current_user, db)

    # Filter companies by accessible IDs
    companies = db.query(Company).filter(Company.id.in_(company_ids)).all()
    return companies


@router.get("/bas-accounts", status_code=status.HTTP_200_OK)
def get_bas_accounts():
    """Get all BAS 2024 reference accounts"""
    bas_file = os.path.join(os.path.dirname(__file__), "..", "data", "bas_2024.json")
    if not os.path.exists(bas_file):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="BAS 2024 data file not found",
        )

    with open(bas_file, encoding="utf-8") as f:
        bas_data = json.load(f)

    return bas_data


@router.get("/{company_id}", response_model=CompanyResponse)
def get_company(
    company_id: int,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Get a specific company"""
    company = db.query(Company).filter(Company.id == company_id).first()
    if not company:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Company {company_id} not found",
        )

    # Verify access
    company_ids = get_user_company_ids(current_user, db)
    if company_id not in company_ids:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have access to this company",
        )

    return company


@router.patch("/{company_id}", response_model=CompanyResponse)
def update_company(
    company_id: int,
    company_update: CompanyUpdate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Update a company"""
    company = db.query(Company).filter(Company.id == company_id).first()
    if not company:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Company {company_id} not found",
        )

    # Verify access
    company_ids = get_user_company_ids(current_user, db)
    if company_id not in company_ids:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have access to this company",
        )

    update_data = company_update.model_dump(exclude_unset=True)

    # Validate payment_type and required fields
    final_payment_type = update_data.get("payment_type", company.payment_type)
    if final_payment_type:
        # Get final values (from update or existing company)
        final_bankgiro = update_data.get("bankgiro_number", company.bankgiro_number)
        final_plusgiro = update_data.get("plusgiro_number", company.plusgiro_number)
        final_clearing = update_data.get("clearing_number", company.clearing_number)
        final_account = update_data.get("account_number", company.account_number)

        if final_payment_type == PaymentType.BANKGIRO and not final_bankgiro:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Bankgironummer krävs för betalningstyp Bankgiro.",
            )
        elif final_payment_type == PaymentType.PLUSGIRO and not final_plusgiro:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Plusgironummer krävs för betalningstyp Plusgiro.",
            )
        elif final_payment_type == PaymentType.BANK_ACCOUNT:
            if not final_clearing or not final_account:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Clearingnummer och kontonummer krävs för betalningstyp Bankkonto.",
                )

    # Validate accounting_basis change
    if "accounting_basis" in update_data and update_data["accounting_basis"] != company.accounting_basis:
        # Get the most recent fiscal year
        current_fy = (
            db.query(FiscalYear)
            .filter(FiscalYear.company_id == company_id)
            .order_by(desc(FiscalYear.start_date))
            .first()
        )

        if current_fy:
            # Check if verifications exist in the current fiscal year
            verification_count = (
                db.query(Verification)
                .filter(
                    Verification.company_id == company_id,
                    Verification.fiscal_year_id == current_fy.id,
                )
                .count()
            )

            if verification_count > 0:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Cannot change accounting method. There are {verification_count} verifications "
                    f"in fiscal year {current_fy.label}. The method can only be changed before the first "
                    f"verification of a new fiscal year.",
                )

    # Update fields
    for field, value in update_data.items():
        setattr(company, field, value)

    db.commit()
    db.refresh(company)
    return company


@router.delete("/{company_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_company(
    company_id: int,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Delete a company (WARNING: deletes all associated data)"""
    company = db.query(Company).filter(Company.id == company_id).first()
    if not company:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Company {company_id} not found",
        )

    # Verify access
    company_ids = get_user_company_ids(current_user, db)
    if company_id not in company_ids:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have access to this company",
        )

    company_service.delete_company(db, company)
    db.commit()
    return None


@router.get("/{company_id}/deadlines")
async def get_deadlines(
    company_id: int,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Statutory deadlines (VAT, and for an AB: INK2, årsredovisning, årsstämma), computed from settings."""
    await verify_company_access(company_id, current_user, db)
    company = db.query(Company).filter(Company.id == company_id).first()
    if not company:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Company {company_id} not found")
    return [d.as_dict() for d in deadline_service.upcoming_deadlines(db, company)]


@router.get("/{company_id}/period-locks", response_model=PeriodLockStatus)
async def get_period_locks(
    company_id: int,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Effective period lock and the lock history."""
    await verify_company_access(company_id, current_user, db)
    history = (
        db.query(PeriodLock).filter(PeriodLock.company_id == company_id).order_by(PeriodLock.created_at.desc()).all()
    )
    return PeriodLockStatus(locked_through=ledger_service.locked_through(db, company_id), history=history)


@router.post("/{company_id}/period-locks", response_model=PeriodLockResponse, status_code=status.HTTP_201_CREATED)
async def lock_period(
    company_id: int,
    body: PeriodLockCreate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Lock the books through a date (typically the end of a declared VAT period).

    Nothing can be posted on or before that date afterwards; corrections go on a
    later date. Locks only move forward.
    """
    await verify_company_access(company_id, current_user, db)
    try:
        lock = ledger_service.lock_period(db, company_id, body.locked_through, current_user, body.note)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    db.commit()
    db.refresh(lock)
    return lock


@router.post("/{company_id}/seed-bas", status_code=status.HTTP_200_OK)
def seed_bas_accounts(
    company_id: int,
    fiscal_year_id: int = Query(..., description="Fiscal Year ID to seed accounts for"),
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Seed BAS 2024 kontoplan for a fiscal year"""
    # Check if company exists
    company = db.query(Company).filter(Company.id == company_id).first()
    if not company:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Company {company_id} not found",
        )

    # Verify access
    company_ids = get_user_company_ids(current_user, db)
    if company_id not in company_ids:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have access to this company",
        )

    # Check if fiscal year exists and belongs to this company
    fiscal_year = db.query(FiscalYear).filter(FiscalYear.id == fiscal_year_id).first()
    if not fiscal_year:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Fiscal year {fiscal_year_id} not found",
        )
    if fiscal_year.company_id != company_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Fiscal year {fiscal_year_id} does not belong to company {company_id}",
        )

    # Check if fiscal year already has accounts
    existing_count = db.query(Account).filter(Account.fiscal_year_id == fiscal_year_id).count()
    if existing_count > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Fiscal year already has {existing_count} accounts. Delete them first if you want to re-seed.",
        )

    # Load BAS accounts from JSON
    bas_file = os.path.join(os.path.dirname(__file__), "..", "data", "bas_2024.json")
    if not os.path.exists(bas_file):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="BAS 2024 data file not found",
        )

    with open(bas_file, encoding="utf-8") as f:
        bas_data = json.load(f)

    # Create accounts
    created_accounts = []
    for account_data in bas_data["accounts"]:
        account = Account(
            company_id=company_id,
            fiscal_year_id=fiscal_year_id,
            account_number=account_data["account_number"],
            name=account_data["name"],
            account_type=account_data["account_type"],
            description=account_data.get("description"),
            active=True,
        )
        db.add(account)
        created_accounts.append(account)

    db.commit()

    # Also initialize default account mappings
    default_account_service.initialize_default_accounts_from_existing(db, company_id, fiscal_year_id)

    defaults_count = db.query(DefaultAccount).filter(DefaultAccount.company_id == company_id).count()

    return {
        "message": f"Successfully seeded {len(created_accounts)} BAS 2024 accounts for fiscal year {fiscal_year.label} and configured {defaults_count} default account mappings",
        "fiscal_year_id": fiscal_year_id,
        "fiscal_year_label": fiscal_year.label,
        "accounts_created": len(created_accounts),
        "default_accounts_configured": defaults_count,
    }


@router.post("/{company_id}/seed-templates", status_code=status.HTTP_200_OK)
def seed_posting_templates(
    company_id: int,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Seed Swedish posting templates for a company"""
    from app.cli import load_posting_templates
    from app.models.posting_template import PostingTemplate, PostingTemplateLine

    # Check if company exists
    company = db.query(Company).filter(Company.id == company_id).first()
    if not company:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Company {company_id} not found",
        )

    # Verify access
    company_ids = get_user_company_ids(current_user, db)
    if company_id not in company_ids:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have access to this company",
        )

    # Get the first fiscal year for this company to find accounts
    # Posting templates are company-wide but need to reference accounts from a fiscal year
    fiscal_year = (
        db.query(FiscalYear).filter(FiscalYear.company_id == company_id).order_by(FiscalYear.start_date).first()
    )

    if not fiscal_year:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Company must have at least one fiscal year with accounts before seeding templates",
        )

    # Check if templates already exist
    existing_count = db.query(PostingTemplate).filter(PostingTemplate.company_id == company_id).count()
    if existing_count > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Company already has {existing_count} posting templates. Delete them first if you want to re-seed.",
        )

    try:
        templates_data = load_posting_templates()
        created_templates = []

        for template_data in templates_data:
            # Create template
            template = PostingTemplate(
                company_id=company_id,
                name=template_data["name"],
                description=template_data["description"],
                default_series=template_data["default_series"],
                default_journal_text=template_data["default_journal_text"],
                sort_order=template_data.get("sort_order", 999),
            )

            db.add(template)
            db.flush()  # Get template ID

            # Create template lines
            for line_data in template_data["lines"]:
                # Verify account exists in this fiscal year
                account_exists = (
                    db.query(Account)
                    .filter(
                        Account.company_id == company_id,
                        Account.fiscal_year_id == fiscal_year.id,
                        Account.account_number == line_data["account_number"],
                    )
                    .first()
                )

                if account_exists:  # Only create line if account exists
                    line = PostingTemplateLine(
                        template_id=template.id,
                        account_number=line_data["account_number"],
                        formula=line_data["formula"],
                        description=line_data["description"],
                        sort_order=line_data["sort_order"],
                    )
                    db.add(line)

            created_templates.append(template)

        db.commit()

        return {
            "message": f"Successfully seeded {len(created_templates)} posting templates",
            "templates_created": len(created_templates),
        }

    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to seed posting templates: {str(e)}",
        ) from e


@router.post("/{company_id}/initialize-defaults", status_code=status.HTTP_200_OK)
def initialize_default_accounts(
    company_id: int,
    fiscal_year_id: int = Query(..., description="Fiscal Year ID to use for account lookup"),
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """
    Initialize default account mappings for a company based on existing accounts.
    This is useful after importing SIE4 or when setting up an existing company.

    fiscal_year_id is required - accounts from that fiscal year will be used.
    """
    company = db.query(Company).filter(Company.id == company_id).first()
    if not company:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Company {company_id} not found",
        )

    # Verify access
    company_ids = get_user_company_ids(current_user, db)
    if company_id not in company_ids:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have access to this company",
        )

    # Get the specified fiscal year
    fiscal_year = (
        db.query(FiscalYear).filter(FiscalYear.id == fiscal_year_id, FiscalYear.company_id == company_id).first()
    )
    if not fiscal_year:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Fiscal year {fiscal_year_id} not found for this company",
        )

    # Initialize defaults
    default_account_service.initialize_default_accounts_from_existing(db, company_id, fiscal_year.id)

    # Count configured defaults
    defaults_count = db.query(DefaultAccount).filter(DefaultAccount.company_id == company_id).count()

    return {
        "message": f"Successfully initialized {defaults_count} default account mappings",
        "default_accounts_configured": defaults_count,
    }


@router.post("/{company_id}/logo", response_model=CompanyResponse)
async def upload_company_logo(
    company_id: int,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Upload a company logo (PNG or JPG only)"""
    # Check if company exists
    company = db.query(Company).filter(Company.id == company_id).first()
    if not company:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Company {company_id} not found",
        )

    # Verify access
    company_ids = get_user_company_ids(current_user, db)
    if company_id not in company_ids:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have access to this company",
        )

    # Validate file type
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File must be an image",
        )

    allowed_types = ["image/png", "image/jpeg", "image/jpg"]
    if file.content_type not in allowed_types:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only PNG and JPG files are allowed",
        )

    # Validate file size (5MB max)
    content = await file.read()
    file_size = len(content)
    if file_size > 5 * 1024 * 1024:  # 5MB
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File size must be less than 5MB",
        )

    # Create uploads directory if it doesn't exist
    upload_dir = str(LOGOS_DIR)
    os.makedirs(upload_dir, exist_ok=True)

    # Generate unique filename
    file_extension = file.filename.split(".")[-1].lower() if file.filename else "png"
    unique_filename = f"{company_id}_{uuid.uuid4().hex}.{file_extension}"
    file_path = os.path.join(upload_dir, unique_filename)

    # Remove old logo file if exists
    if company.logo_filename:
        old_file_path = os.path.join(upload_dir, company.logo_filename)
        if os.path.exists(old_file_path):
            os.remove(old_file_path)

    # Save new file
    with open(file_path, "wb") as buffer:
        buffer.write(content)

    # Update company record
    company.logo_filename = unique_filename
    db.commit()
    db.refresh(company)

    return company


@router.get("/{company_id}/logo")
async def get_company_logo(
    company_id: int,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Download company logo"""
    company = db.query(Company).filter(Company.id == company_id).first()
    if not company:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Company {company_id} not found",
        )

    # Verify access
    company_ids = get_user_company_ids(current_user, db)
    if company_id not in company_ids:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have access to this company",
        )

    if not company.logo_filename:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No logo found for this company",
        )

    file_path = str(LOGOS_DIR / company.logo_filename)
    if not os.path.exists(file_path):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Logo file not found on disk",
        )

    # Determine media type from file extension
    file_extension = company.logo_filename.split(".")[-1].lower()
    media_type = "image/png" if file_extension == "png" else "image/jpeg"

    return FileResponse(
        path=file_path,
        media_type=media_type,
        filename=f"company_{company_id}_logo.{file_extension}",
    )


@router.delete("/{company_id}/logo", response_model=CompanyResponse)
async def delete_company_logo(
    company_id: int,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Delete company logo"""
    company = db.query(Company).filter(Company.id == company_id).first()
    if not company:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Company {company_id} not found",
        )

    # Verify access
    company_ids = get_user_company_ids(current_user, db)
    if company_id not in company_ids:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have access to this company",
        )

    if not company.logo_filename:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No logo found for this company",
        )

    # Remove file from disk
    file_path = str(LOGOS_DIR / company.logo_filename)
    if os.path.exists(file_path):
        os.remove(file_path)

    # Clear logo_filename from database
    company.logo_filename = None
    db.commit()
    db.refresh(company)

    return company
