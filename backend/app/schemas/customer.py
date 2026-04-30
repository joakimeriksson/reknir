from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models.company import PaymentType


class CustomerBase(BaseModel):
    """Base customer schema"""

    name: str = Field(..., min_length=1, max_length=200)
    org_number: str | None = Field(None, max_length=15)
    contact_person: str | None = None
    email: EmailStr | None = None
    phone: str | None = None
    address: str | None = None
    postal_code: str | None = Field(None, max_length=10)
    city: str | None = None
    country: str = "Sverige"
    payment_terms_days: int = Field(30, ge=0, le=365)


class CustomerCreate(CustomerBase):
    """Schema for creating a customer"""

    company_id: int


class CustomerUpdate(BaseModel):
    """Schema for updating a customer"""

    name: str | None = None
    org_number: str | None = None
    contact_person: str | None = None
    email: EmailStr | None = None
    phone: str | None = None
    address: str | None = None
    postal_code: str | None = None
    city: str | None = None
    country: str | None = None
    payment_terms_days: int | None = None
    active: bool | None = None


class CustomerResponse(CustomerBase):
    """Schema for customer response"""

    id: int
    company_id: int
    active: bool

    model_config = ConfigDict(from_attributes=True)


class SupplierBase(BaseModel):
    """Base supplier schema"""

    name: str = Field(..., min_length=1, max_length=200)
    org_number: str | None = Field(None, max_length=15)
    contact_person: str | None = None
    email: EmailStr | None = None
    phone: str | None = None
    address: str | None = None
    postal_code: str | None = Field(None, max_length=10)
    city: str | None = None
    country: str = "Sverige"
    payment_terms_days: int = Field(30, ge=0, le=365)
    payment_type: PaymentType | None = None
    bankgiro_number: str | None = None
    plusgiro_number: str | None = None
    clearing_number: str | None = None
    account_number: str | None = None
    iban: str | None = None
    bic: str | None = None


class SupplierCreate(SupplierBase):
    """Schema for creating a supplier"""

    company_id: int


class SupplierUpdate(BaseModel):
    """Schema for updating a supplier"""

    name: str | None = None
    org_number: str | None = None
    contact_person: str | None = None
    email: EmailStr | None = None
    phone: str | None = None
    address: str | None = None
    postal_code: str | None = None
    city: str | None = None
    country: str | None = None
    payment_terms_days: int | None = None
    payment_type: PaymentType | None = None
    bankgiro_number: str | None = None
    plusgiro_number: str | None = None
    clearing_number: str | None = None
    account_number: str | None = None
    iban: str | None = None
    bic: str | None = None
    active: bool | None = None


class SupplierResponse(SupplierBase):
    """Schema for supplier response"""

    id: int
    company_id: int
    active: bool

    model_config = ConfigDict(from_attributes=True)
