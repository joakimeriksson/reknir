from datetime import datetime

from pydantic import BaseModel, ConfigDict, EmailStr, Field

# ==================== User Schemas ====================


class UserBase(BaseModel):
    """Base user schema"""

    email: EmailStr
    full_name: str = Field(..., min_length=1, max_length=200)


class UserCreate(UserBase):
    """Schema for creating a user"""

    password: str = Field(..., min_length=8, max_length=100)


class UserUpdate(BaseModel):
    """Schema for a user updating their own profile.

    Changing the e-mail address or the password requires ``current_password``.
    """

    email: EmailStr | None = None
    full_name: str | None = Field(None, min_length=1, max_length=200)
    password: str | None = Field(None, min_length=8, max_length=100)
    current_password: str | None = Field(None, max_length=100)


class AdminUserUpdate(BaseModel):
    """Schema for an admin updating another user's account."""

    email: EmailStr | None = None
    full_name: str | None = Field(None, min_length=1, max_length=200)
    is_active: bool | None = None
    is_admin: bool | None = None


class PasswordResetLink(BaseModel):
    """A one-time password reset link created by an admin or the CLI."""

    token: str
    path: str = Field(..., description="Frontend path, e.g. /reset-password/<token>")
    expires_at: datetime


class PasswordResetValidation(BaseModel):
    """Result of checking a password reset token."""

    valid: bool
    email: str | None = None
    full_name: str | None = None
    message: str | None = None


class PasswordResetRequest(BaseModel):
    """New password submitted together with a reset token."""

    password: str = Field(..., min_length=8, max_length=100)


class UserResponse(UserBase):
    """Schema for user response (without sensitive data)"""

    id: int
    is_admin: bool
    is_active: bool
    is_service_account: bool = False
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class UserWithCompanies(UserResponse):
    """User response with list of company IDs they have access to"""

    company_ids: list[int] = []


# ==================== Auth Schemas ====================


class Token(BaseModel):
    """JWT token response"""

    access_token: str
    token_type: str = "bearer"


class TokenData(BaseModel):
    """Data encoded in JWT token"""

    user_id: int
    email: str
    is_admin: bool


class LoginRequest(BaseModel):
    """Login request with email/password"""

    email: EmailStr
    password: str


# ==================== CompanyUser Schemas ====================


class CompanyUserBase(BaseModel):
    """Base company-user association schema"""

    company_id: int
    user_id: int
    role: str = "accountant"


class CompanyUserCreate(BaseModel):
    """Schema for granting user access to company"""

    user_id: int
    role: str = "accountant"


class CompanyUserResponse(CompanyUserBase):
    """Schema for company-user response"""

    id: int
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class CompanyAccessRequest(BaseModel):
    """Request to grant/modify company access"""

    role: str = Field(default="accountant", description="User role in this company")


# ==================== Service Account Schemas ====================


class ServiceAccountCreate(BaseModel):
    """Schema for creating a service account"""

    full_name: str = Field(..., min_length=1, max_length=200, description="Descriptive name, e.g. 'MCP Bot'")


class ServiceAccountResponse(BaseModel):
    """Schema for service account response"""

    id: int
    full_name: str
    email: str
    is_admin: bool
    is_active: bool
    is_service_account: bool
    owner_id: int | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ServiceAccountCreated(ServiceAccountResponse):
    """Returned only at creation time - includes the plaintext API key"""

    api_key: str = Field(..., description="Store this securely - it cannot be retrieved again.")


class ApiKeyExchangeRequest(BaseModel):
    """Schema for exchanging an API key for a JWT"""

    api_key: str = Field(..., min_length=32)


class ApiKeyRotateResponse(BaseModel):
    """Returned when rotating an API key"""

    api_key: str = Field(..., description="The new API key. Store it securely.")
