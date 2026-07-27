"""
Dependency functions for authentication and authorization
"""

from fastapi import Depends, HTTPException, Query, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import CompanyUser, User
from app.services.auth_service import decode_access_token

# OAuth2 scheme for token extraction
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


async def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    """
    Dependency to get the current authenticated user from JWT token

    Args:
        token: JWT token from Authorization header
        db: Database session

    Returns:
        Current User object

    Raises:
        HTTPException 401: If token is invalid or user not found
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    # Decode token
    token_data = decode_access_token(token)
    if token_data is None:
        raise credentials_exception

    # Get user from database
    user = db.query(User).filter(User.id == token_data.user_id).first()
    if user is None:
        raise credentials_exception

    return user


async def get_current_active_user(current_user: User = Depends(get_current_user)) -> User:
    """
    Dependency to ensure the current user is active

    Args:
        current_user: Current user from get_current_user

    Returns:
        Current active User object

    Raises:
        HTTPException 400: If user account is inactive
    """
    if not current_user.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Inactive user account")
    return current_user


async def require_admin(current_user: User = Depends(get_current_active_user)) -> User:
    """
    Dependency to require admin privileges

    Args:
        current_user: Current active user

    Returns:
        Current user if admin

    Raises:
        HTTPException 403: If user is not an admin
    """
    if not current_user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin privileges required")
    return current_user


async def verify_company_access(
    company_id: int = Query(..., description="Company ID"),
    current_user: User = Depends(get_current_active_user),
    db: Session = Depends(get_db),
) -> None:
    """
    Dependency to verify that the current user has access to a specific company

    Admins have access to all companies.
    Regular users must have explicit company access via CompanyUser.

    Args:
        company_id: ID of the company to check access for
        current_user: Current active user
        db: Database session

    Raises:
        HTTPException 403: If user doesn't have access to the company
    """
    # Admins can access all companies
    if current_user.is_admin:
        return

    # Check if user has explicit access to this company
    access = (
        db.query(CompanyUser)
        .filter(CompanyUser.user_id == current_user.id, CompanyUser.company_id == company_id)
        .first()
    )

    if not access:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail=f"You don't have access to company {company_id}"
        )


def get_user_company_ids(user: User, db: Session) -> list[int]:
    """
    Get list of company IDs that a user has access to

    Admins get all company IDs.
    Regular users get only their assigned companies.

    Args:
        user: User object
        db: Database session

    Returns:
        List of company IDs
    """
    if user.is_admin:
        # Admin has access to all companies
        from app.models.company import Company

        companies = db.query(Company).all()
        return [c.id for c in companies]
    else:
        # Regular user - get assigned companies
        company_users = db.query(CompanyUser).filter(CompanyUser.user_id == user.id).all()
        return [cu.company_id for cu in company_users]
