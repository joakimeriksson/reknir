from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_active_user, get_user_company_ids, verify_company_access
from app.models.account import Account
from app.models.company import Company
from app.models.fiscal_year import FiscalYear
from app.models.user import User
from app.models.verification import Verification
from app.schemas.fiscal_year import FiscalYearCreate, FiscalYearResponse, FiscalYearUpdate

router = APIRouter()


@router.post("/", response_model=FiscalYearResponse, status_code=status.HTTP_201_CREATED)
def create_fiscal_year(
    fiscal_year: FiscalYearCreate, current_user: User = Depends(get_current_active_user), db: Session = Depends(get_db)
):
    """Create a new fiscal year"""
    # Verify user has access to this company
    company_ids = get_user_company_ids(current_user, db)
    if fiscal_year.company_id not in company_ids:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=f"You don't have access to company {fiscal_year.company_id}"
        )

    # Verify company exists
    company = db.query(Company).filter(Company.id == fiscal_year.company_id).first()
    if not company:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Company {fiscal_year.company_id} not found")

    # Check for overlapping fiscal years
    overlapping = (
        db.query(FiscalYear)
        .filter(
            FiscalYear.company_id == fiscal_year.company_id,
            FiscalYear.start_date <= fiscal_year.end_date,
            FiscalYear.end_date >= fiscal_year.start_date,
        )
        .first()
    )

    if overlapping:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Fiscal year overlaps with existing fiscal year {overlapping.label}",
        )

    # Create fiscal year
    db_fiscal_year = FiscalYear(**fiscal_year.model_dump())
    db.add(db_fiscal_year)
    db.commit()
    db.refresh(db_fiscal_year)

    return db_fiscal_year


@router.get("/", response_model=list[FiscalYearResponse])
def list_fiscal_years(
    company_id: int = Query(..., description="Company ID"),
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
    _: None = Depends(verify_company_access),
):
    """List all fiscal years for a company"""
    fiscal_years = (
        db.query(FiscalYear).filter(FiscalYear.company_id == company_id).order_by(FiscalYear.year.desc()).all()
    )

    return fiscal_years


@router.get("/{fiscal_year_id}", response_model=FiscalYearResponse)
def get_fiscal_year(
    fiscal_year_id: int, current_user: User = Depends(get_current_active_user), db: Session = Depends(get_db)
):
    """Get a specific fiscal year"""
    fiscal_year = db.query(FiscalYear).filter(FiscalYear.id == fiscal_year_id).first()
    if not fiscal_year:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Fiscal year {fiscal_year_id} not found")

    # Verify access
    company_ids = get_user_company_ids(current_user, db)
    if fiscal_year.company_id not in company_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You don't have access to this fiscal year")

    return fiscal_year


@router.get("/current/by-company/{company_id}", response_model=FiscalYearResponse | None)
def get_current_fiscal_year(
    company_id: int, current_user: User = Depends(get_current_active_user), db: Session = Depends(get_db)
):
    """Get the current fiscal year for a company (based on today's date)"""
    # Verify access
    company_ids = get_user_company_ids(current_user, db)
    if company_id not in company_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You don't have access to this company")

    today = date.today()

    fiscal_year = (
        db.query(FiscalYear)
        .filter(FiscalYear.company_id == company_id, FiscalYear.start_date <= today, FiscalYear.end_date >= today)
        .first()
    )

    return fiscal_year


@router.patch("/{fiscal_year_id}", response_model=FiscalYearResponse)
def update_fiscal_year(
    fiscal_year_id: int,
    fiscal_year_update: FiscalYearUpdate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Update a fiscal year"""
    fiscal_year = db.query(FiscalYear).filter(FiscalYear.id == fiscal_year_id).first()
    if not fiscal_year:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Fiscal year {fiscal_year_id} not found")

    # Verify access
    company_ids = get_user_company_ids(current_user, db)
    if fiscal_year.company_id not in company_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You don't have access to this fiscal year")

    # Update fields
    update_data = fiscal_year_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(fiscal_year, field, value)

    db.commit()
    db.refresh(fiscal_year)
    return fiscal_year


@router.delete("/{fiscal_year_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_fiscal_year(
    fiscal_year_id: int, current_user: User = Depends(get_current_active_user), db: Session = Depends(get_db)
):
    """Delete a fiscal year (WARNING: will detach all associated verifications)"""
    fiscal_year = db.query(FiscalYear).filter(FiscalYear.id == fiscal_year_id).first()
    if not fiscal_year:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Fiscal year {fiscal_year_id} not found")

    # Verify access
    company_ids = get_user_company_ids(current_user, db)
    if fiscal_year.company_id not in company_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You don't have access to this fiscal year")

    # Detach verifications (set fiscal_year_id to NULL)
    db.query(Verification).filter(Verification.fiscal_year_id == fiscal_year_id).update({"fiscal_year_id": None})

    db.delete(fiscal_year)
    db.commit()
    return None


@router.post("/{fiscal_year_id}/assign-verifications", status_code=status.HTTP_200_OK)
def assign_verifications_to_fiscal_year(
    fiscal_year_id: int, current_user: User = Depends(get_current_active_user), db: Session = Depends(get_db)
):
    """
    Assign all unassigned verifications to this fiscal year based on transaction_date.
    Also reassign verifications that fall within this fiscal year's date range.
    """
    fiscal_year = db.query(FiscalYear).filter(FiscalYear.id == fiscal_year_id).first()
    if not fiscal_year:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Fiscal year {fiscal_year_id} not found")

    # Verify access
    company_ids = get_user_company_ids(current_user, db)
    if fiscal_year.company_id not in company_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You don't have access to this fiscal year")

    # Find verifications within this fiscal year's date range
    verifications = (
        db.query(Verification)
        .filter(
            Verification.company_id == fiscal_year.company_id,
            Verification.transaction_date >= fiscal_year.start_date,
            Verification.transaction_date <= fiscal_year.end_date,
        )
        .all()
    )

    count = 0
    for verification in verifications:
        verification.fiscal_year_id = fiscal_year_id
        count += 1

    db.commit()

    return {
        "message": f"Assigned {count} verifications to fiscal year {fiscal_year.label}",
        "verifications_assigned": count,
    }


@router.post("/{fiscal_year_id}/copy-chart-of-accounts", status_code=status.HTTP_200_OK)
def copy_chart_of_accounts(
    fiscal_year_id: int,
    source_fiscal_year_id: int | None = None,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """
    Copy chart of accounts from a previous fiscal year to this fiscal year.
    If source_fiscal_year_id is not provided, uses the most recent previous fiscal year.
    """
    # Get target fiscal year
    target_fiscal_year = db.query(FiscalYear).filter(FiscalYear.id == fiscal_year_id).first()
    if not target_fiscal_year:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Fiscal year {fiscal_year_id} not found")

    # Verify access
    company_ids = get_user_company_ids(current_user, db)
    if target_fiscal_year.company_id not in company_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You don't have access to this fiscal year")

    # Check if target fiscal year already has accounts
    existing_accounts_count = db.query(Account).filter(Account.fiscal_year_id == fiscal_year_id).count()
    if existing_accounts_count > 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Target fiscal year already has {existing_accounts_count} accounts. Cannot copy chart of accounts.",
        )

    # Determine source fiscal year
    if source_fiscal_year_id:
        source_fiscal_year = db.query(FiscalYear).filter(FiscalYear.id == source_fiscal_year_id).first()
        if not source_fiscal_year:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail=f"Source fiscal year {source_fiscal_year_id} not found"
            )
        if source_fiscal_year.company_id != target_fiscal_year.company_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Source and target fiscal years must belong to the same company",
            )
    else:
        # Find the most recent previous fiscal year for this company
        source_fiscal_year = (
            db.query(FiscalYear)
            .filter(
                FiscalYear.company_id == target_fiscal_year.company_id,
                FiscalYear.end_date < target_fiscal_year.start_date,
            )
            .order_by(FiscalYear.end_date.desc())
            .first()
        )

        if not source_fiscal_year:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="No previous fiscal year found to copy from"
            )

    # Get all accounts from source fiscal year
    source_accounts = db.query(Account).filter(Account.fiscal_year_id == source_fiscal_year.id).all()

    if not source_accounts:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Source fiscal year {source_fiscal_year.label} has no accounts to copy",
        )

    # Copy accounts to target fiscal year
    from app.models.account import AccountType

    created_accounts = []

    for source_account in source_accounts:
        # Determine opening balance for the new fiscal year:
        # - Balance accounts (Asset, Equity/Liability): carry forward current_balance from previous year
        # - Result accounts (Revenue, Cost): reset to 0
        is_balance_account = source_account.account_type in [AccountType.ASSET, AccountType.EQUITY_LIABILITY]
        opening_balance = source_account.current_balance if is_balance_account else 0

        new_account = Account(
            company_id=target_fiscal_year.company_id,
            fiscal_year_id=target_fiscal_year.id,
            account_number=source_account.account_number,
            name=source_account.name,
            description=source_account.description,
            account_type=source_account.account_type,
            opening_balance=opening_balance,
            current_balance=opening_balance,  # Current balance starts at opening balance
            active=source_account.active,  # Preserve active/inactive status
            is_bas_account=source_account.is_bas_account,
        )
        db.add(new_account)
        created_accounts.append(new_account)

    db.commit()

    return {
        "message": f"Successfully copied {len(created_accounts)} accounts from fiscal year {source_fiscal_year.label} to {target_fiscal_year.label}",
        "source_fiscal_year_id": source_fiscal_year.id,
        "source_fiscal_year_label": source_fiscal_year.label,
        "target_fiscal_year_id": target_fiscal_year.id,
        "target_fiscal_year_label": target_fiscal_year.label,
        "accounts_copied": len(created_accounts),
    }
