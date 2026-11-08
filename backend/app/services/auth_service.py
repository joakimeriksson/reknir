"""
Authentication service for password hashing and JWT token management
"""

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta

from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from app.config import settings
from app.models.user import User
from app.schemas.user import TokenData

# Password hashing context
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """
    Verify a plain password against a hashed password

    Args:
        plain_password: Plain text password from user input
        hashed_password: Hashed password from database

    Returns:
        True if password matches, False otherwise
    """
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    """
    Hash a plain password using bcrypt

    Args:
        password: Plain text password

    Returns:
        Hashed password string
    """
    return pwd_context.hash(password)


def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    """
    Create a JWT access token

    Args:
        data: Dictionary of data to encode in the token (user_id, email, etc.)
        expires_delta: Optional custom expiration time

    Returns:
        Encoded JWT token string
    """
    to_encode = data.copy()

    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=settings.access_token_expire_minutes)

    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, settings.secret_key, algorithm=settings.algorithm)

    return encoded_jwt


def decode_access_token(token: str) -> TokenData | None:
    """
    Decode and validate a JWT access token

    Args:
        token: JWT token string

    Returns:
        TokenData if valid, None if invalid or expired
    """
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
        if payload.get("purpose"):
            # Special-purpose tokens (password reset) never grant API access
            return None
        print(f"DEBUG: JWT payload decoded: {payload}")
        sub: str = payload.get("sub")
        email: str = payload.get("email")
        is_admin: bool = payload.get("is_admin", False)

        if sub is None or email is None:
            print("DEBUG: sub or email is None, returning None")
            return None

        # Convert sub (string) to user_id (int)
        try:
            user_id = int(sub)
        except (ValueError, TypeError):
            print(f"DEBUG: Failed to convert sub to int: {sub}")
            return None

        print(f"DEBUG: Extracted from payload - user_id={user_id}, email={email}, is_admin={is_admin}")

        return TokenData(user_id=user_id, email=email, is_admin=is_admin)
    except JWTError as e:
        print(f"DEBUG: JWTError occurred: {e}")
        return None


def authenticate_user(db: Session, email: str, password: str) -> User | None:
    """
    Authenticate a user by email and password

    Args:
        db: Database session
        email: User email
        password: Plain text password

    Returns:
        User object if authentication successful, None otherwise
    """
    user = db.query(User).filter(User.email == email).first()

    if not user:
        return None

    if not verify_password(password, user.hashed_password):
        return None

    return user


def create_user(db: Session, email: str, password: str, full_name: str, is_admin: bool = False) -> User:
    """
    Create a new user with hashed password

    Args:
        db: Database session
        email: User email
        password: Plain text password (will be hashed)
        full_name: User's full name
        is_admin: Whether user is admin (default False)

    Returns:
        Created User object
    """
    hashed_password = get_password_hash(password)

    user = User(email=email, hashed_password=hashed_password, full_name=full_name, is_admin=is_admin, is_active=True)

    db.add(user)
    db.commit()
    db.refresh(user)

    return user


# ==================== Password Reset ====================

PASSWORD_RESET_PURPOSE = "password_reset"
PASSWORD_RESET_HOURS = 24


def _password_fingerprint(hashed_password: str) -> str:
    """Short fingerprint of the stored hash; changes whenever the password does."""
    return hashlib.sha256(hashed_password.encode()).hexdigest()[:16]


def create_password_reset_token(user: User, hours: int = PASSWORD_RESET_HOURS) -> tuple[str, datetime]:
    """Create a signed one-time password reset token for ``user``.

    The token is stateless: it is bound to the user's current password hash, so it
    stops working as soon as the password is changed (by this token or otherwise),
    and it expires after ``hours``. Returns the token and its expiry time (UTC).
    """
    expires_at = datetime.utcnow() + timedelta(hours=hours)
    payload = {
        "sub": str(user.id),
        "purpose": PASSWORD_RESET_PURPOSE,
        "pw": _password_fingerprint(user.hashed_password),
        "exp": expires_at,
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm), expires_at


def verify_password_reset_token(db: Session, token: str) -> User | None:
    """Return the user a reset token belongs to, or None if it is invalid, expired or used."""
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
    except JWTError:
        return None
    if payload.get("purpose") != PASSWORD_RESET_PURPOSE:
        return None
    try:
        user_id = int(payload.get("sub"))
    except (TypeError, ValueError):
        return None
    user = db.query(User).filter(User.id == user_id).first()
    if not user or not user.is_active or user.is_service_account:
        return None
    if payload.get("pw") != _password_fingerprint(user.hashed_password):
        return None
    return user


def set_password(db: Session, user: User, new_password: str) -> None:
    """Replace a user's password. Invalidates any outstanding reset tokens."""
    user.hashed_password = get_password_hash(new_password)
    db.commit()


def generate_password(length: int = 16) -> str:
    """Generate a random password that is easy to type (no ambiguous characters)."""
    alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(length))


# ==================== Service Account Functions ====================


def generate_api_key() -> str:
    """Generate a prefixed API key using cryptographically secure random bytes"""
    return f"rknr_{secrets.token_hex(32)}"


def hash_api_key(api_key: str) -> str:
    """Hash an API key using bcrypt"""
    return pwd_context.hash(api_key)


def create_service_account(db: Session, full_name: str, owner_id: int) -> tuple[User, str]:
    """Create a service account with an API key.

    Returns the User object and the plaintext API key (shown once).
    """
    api_key = generate_api_key()
    short_id = uuid.uuid4().hex[:8]

    user = User(
        email=f"sa-{short_id}@service.reknir.local",
        hashed_password=get_password_hash(secrets.token_hex(32)),
        full_name=full_name,
        is_admin=False,
        is_active=True,
        is_service_account=True,
        owner_id=owner_id,
        api_key_hash=hash_api_key(api_key),
    )

    db.add(user)
    db.commit()
    db.refresh(user)

    return user, api_key


def authenticate_by_api_key(db: Session, api_key: str) -> User | None:
    """Authenticate a service account by API key.

    Iterates active service accounts and verifies the key against each hash.
    Fine for small number of service accounts.
    """
    service_accounts = (
        db.query(User)
        .filter(User.is_service_account.is_(True), User.is_active.is_(True), User.api_key_hash.isnot(None))
        .all()
    )

    for sa in service_accounts:
        if pwd_context.verify(api_key, sa.api_key_hash):
            return sa

    return None


def rotate_api_key(db: Session, service_account: User) -> str:
    """Generate a new API key for a service account. Returns the plaintext key."""
    api_key = generate_api_key()
    service_account.api_key_hash = hash_api_key(api_key)
    db.commit()
    return api_key
