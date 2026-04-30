from sqlalchemy import Boolean, Column, ForeignKey, Integer, String
from sqlalchemy import Enum as SQLEnum
from sqlalchemy.orm import relationship

from app.database import Base
from app.models.company import PaymentType


class Customer(Base):
    """Customer register (Kundregister)"""

    __tablename__ = "customers"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False)

    # Customer details
    name = Column(String, nullable=False)
    org_number = Column(String(15), nullable=True)  # Optional for individuals
    contact_person = Column(String, nullable=True)
    email = Column(String, nullable=True)
    phone = Column(String, nullable=True)

    # Address
    address = Column(String, nullable=True)
    postal_code = Column(String(10), nullable=True)
    city = Column(String, nullable=True)
    country = Column(String, default="Sverige", nullable=False)

    # Payment terms
    payment_terms_days = Column(Integer, default=30, nullable=False)  # Default 30 days

    # Status
    active = Column(Boolean, default=True, nullable=False)

    # Relationships
    company = relationship("Company")
    invoices = relationship("Invoice", back_populates="customer", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Customer {self.name}>"


class Supplier(Base):
    """Supplier register (Leverantörsregister)"""

    __tablename__ = "suppliers"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False)

    # Supplier details
    name = Column(String, nullable=False)
    org_number = Column(String(15), nullable=True)
    contact_person = Column(String, nullable=True)
    email = Column(String, nullable=True)
    phone = Column(String, nullable=True)

    # Address
    address = Column(String, nullable=True)
    postal_code = Column(String(10), nullable=True)
    city = Column(String, nullable=True)
    country = Column(String, default="Sverige", nullable=False)

    # Payment terms
    payment_terms_days = Column(Integer, default=30, nullable=False)

    # Payment information
    payment_type = Column(
        SQLEnum(PaymentType, values_callable=lambda x: [e.value for e in x]),
        nullable=True,
    )
    bankgiro_number = Column(String(20), nullable=True)
    plusgiro_number = Column(String(20), nullable=True)
    clearing_number = Column(String(10), nullable=True)
    account_number = Column(String(20), nullable=True)
    iban = Column(String(34), nullable=True)
    bic = Column(String(11), nullable=True)

    # Status
    active = Column(Boolean, default=True, nullable=False)

    # Relationships
    company = relationship("Company")
    supplier_invoices = relationship("SupplierInvoice", back_populates="supplier", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Supplier {self.name}>"
