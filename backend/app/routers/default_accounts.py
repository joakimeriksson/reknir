"""Default Accounts Router"""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_active_user, get_user_company_ids
from app.models.account import Account
from app.models.default_account import DefaultAccount
from app.models.user import User

router = APIRouter(prefix="/api/default-accounts", tags=["default-accounts"])


class DefaultAccountResponse(BaseModel):
    """Response model for default account"""

    id: int
    company_id: int
    account_type: str
    account_id: int
    account_number: int
    account_name: str

    class Config:
        from_attributes = True


@router.get("/", response_model=list[DefaultAccountResponse])
def list_default_accounts(
    company_id: int, current_user: User = Depends(get_current_active_user), db: Session = Depends(get_db)
):
    """List all default account mappings for a company"""
    # Verify access
    company_ids = get_user_company_ids(current_user, db)
    if company_id not in company_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You don't have access to this company")

    defaults = db.query(DefaultAccount).filter(DefaultAccount.company_id == company_id).all()

    # Enrich with account details
    result = []
    for default in defaults:
        account = db.query(Account).filter(Account.id == default.account_id).first()
        if account:
            result.append(
                DefaultAccountResponse(
                    id=default.id,
                    company_id=default.company_id,
                    account_type=default.account_type,
                    account_id=default.account_id,
                    account_number=account.account_number,
                    account_name=account.name,
                )
            )

    return result


class DefaultAccountUpdate(BaseModel):
    """Request model for updating a default account"""

    account_id: int


class DefaultAccountCreate(BaseModel):
    """Request model for creating a default account"""

    company_id: int
    account_type: str
    account_id: int


@router.post("/", response_model=DefaultAccountResponse, status_code=status.HTTP_201_CREATED)
def create_default_account(
    create: DefaultAccountCreate, current_user: User = Depends(get_current_active_user), db: Session = Depends(get_db)
):
    """Create a new default account mapping"""
    # Verify access
    company_ids = get_user_company_ids(current_user, db)
    if create.company_id not in company_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You don't have access to this company")

    # Verify the account exists
    account = db.query(Account).filter(Account.id == create.account_id).first()
    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Account {create.account_id} not found")

    # Verify account belongs to the specified company
    if account.company_id != create.company_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Account must belong to the same company")

    # Check if default account already exists for this type
    existing = (
        db.query(DefaultAccount)
        .filter(DefaultAccount.company_id == create.company_id, DefaultAccount.account_type == create.account_type)
        .first()
    )

    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Default account for type {create.account_type} already exists",
        )

    # Create the default account
    default = DefaultAccount(
        company_id=create.company_id, account_type=create.account_type, account_id=create.account_id
    )
    db.add(default)
    db.commit()
    db.refresh(default)

    # Return enriched response
    return DefaultAccountResponse(
        id=default.id,
        company_id=default.company_id,
        account_type=default.account_type,
        account_id=default.account_id,
        account_number=account.account_number,
        account_name=account.name,
    )


@router.patch("/{default_account_id}", response_model=DefaultAccountResponse)
def update_default_account(
    default_account_id: int,
    update: DefaultAccountUpdate,
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
):
    """Update a default account mapping"""
    # Find the default account
    default = db.query(DefaultAccount).filter(DefaultAccount.id == default_account_id).first()
    if not default:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"Default account {default_account_id} not found"
        )

    # Verify access
    company_ids = get_user_company_ids(current_user, db)
    if default.company_id not in company_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You don't have access to this company")

    # Verify the new account exists and belongs to the same company
    account = db.query(Account).filter(Account.id == update.account_id).first()
    if not account:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Account {update.account_id} not found")

    if account.company_id != default.company_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Account must belong to the same company")

    # Update the default account
    default.account_id = update.account_id
    db.commit()
    db.refresh(default)

    # Return enriched response
    return DefaultAccountResponse(
        id=default.id,
        company_id=default.company_id,
        account_type=default.account_type,
        account_id=default.account_id,
        account_number=account.account_number,
        account_name=account.name,
    )


@router.delete("/{default_account_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_default_account(
    default_account_id: int, current_user: User = Depends(get_current_active_user), db: Session = Depends(get_db)
):
    """Delete a default account mapping"""
    default = db.query(DefaultAccount).filter(DefaultAccount.id == default_account_id).first()
    if not default:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"Default account {default_account_id} not found"
        )

    # Verify access
    company_ids = get_user_company_ids(current_user, db)
    if default.company_id not in company_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You don't have access to this company")

    db.delete(default)
    db.commit()
    return None
