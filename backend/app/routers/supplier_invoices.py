from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_active_user, verify_company_access
from app.models.attachment import Attachment, AttachmentLink, AttachmentRole, EntityType
from app.models.company import AccountingBasis, Company
from app.models.customer import Supplier
from app.models.fiscal_year import FiscalYear
from app.models.invoice import (
    InvoiceStatus,
    PaymentStatus,
    SupplierInvoice,
    SupplierInvoiceLine,
    SupplierInvoicePayment,
)
from app.models.user import User
from app.schemas.attachment import AttachmentLinkCreate, EntityAttachmentItem
from app.schemas.invoice import (
    MarkPaidRequest,
    SupplierInvoiceCreate,
    SupplierInvoiceListItem,
    SupplierInvoiceResponse,
    SupplierInvoiceUpdate,
)
from app.services.invoice_service import (
    create_supplier_invoice_payment_verification,
    create_supplier_invoice_verification,
)

router = APIRouter()


def _propagate_invoice_attachments_to_verification(db: Session, invoice_id: int, verification_id: int) -> None:
    invoice_links = (
        db.query(AttachmentLink)
        .filter(
            AttachmentLink.entity_type == EntityType.SUPPLIER_INVOICE,
            AttachmentLink.entity_id == invoice_id,
        )
        .all()
    )
    for link in invoice_links:
        db.add(
            AttachmentLink(
                attachment_id=link.attachment_id,
                entity_type=EntityType.VERIFICATION,
                entity_id=verification_id,
                role=AttachmentRole.ORIGINAL,
                sort_order=link.sort_order,
            )
        )


@router.post("/", response_model=SupplierInvoiceResponse, status_code=status.HTTP_201_CREATED)
async def create_supplier_invoice(
    invoice_data: SupplierInvoiceCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Create a new supplier invoice (register incoming invoice)"""
    # Verify user has access to this company
    await verify_company_access(invoice_data.company_id, current_user, db)

    # Get next internal tracking number
    last_invoice = (
        db.query(SupplierInvoice)
        .filter(SupplierInvoice.company_id == invoice_data.company_id)
        .order_by(desc(SupplierInvoice.our_invoice_number))
        .first()
    )

    next_number = (last_invoice.our_invoice_number + 1) if last_invoice and last_invoice.our_invoice_number else 1

    # Calculate totals from lines
    total_net = Decimal("0")
    total_vat = Decimal("0")

    invoice_lines_data = []
    for line_data in invoice_data.supplier_invoice_lines:
        net_amount = line_data.quantity * line_data.unit_price
        vat_amount = net_amount * (line_data.vat_rate / 100)
        total_amount = net_amount + vat_amount

        total_net += net_amount
        total_vat += vat_amount

        invoice_lines_data.append(
            {**line_data.model_dump(), "net_amount": net_amount, "vat_amount": vat_amount, "total_amount": total_amount}
        )

    # Create supplier invoice
    invoice = SupplierInvoice(
        company_id=invoice_data.company_id,
        supplier_id=invoice_data.supplier_id,
        supplier_invoice_number=invoice_data.supplier_invoice_number,
        our_invoice_number=next_number,
        invoice_date=invoice_data.invoice_date,
        due_date=invoice_data.due_date,
        ocr_number=invoice_data.ocr_number,
        reference=invoice_data.reference,
        notes=invoice_data.notes,
        total_amount=total_net + total_vat,
        vat_amount=total_vat,
        net_amount=total_net,
        status=InvoiceStatus.DRAFT,
    )
    db.add(invoice)
    db.flush()

    # Create invoice lines
    for line_data in invoice_lines_data:
        invoice_line = SupplierInvoiceLine(supplier_invoice_id=invoice.id, **line_data)
        db.add(invoice_line)

    db.commit()
    db.refresh(invoice)

    return invoice


@router.get("/", response_model=list[SupplierInvoiceListItem])
async def list_supplier_invoices(
    company_id: int = Query(..., description="Company ID"),
    fiscal_year_id: int | None = Query(None, description="Filter by fiscal year"),
    supplier_id: int | None = None,
    status: InvoiceStatus | None = None,
    start_date: date | None = None,
    end_date: date | None = None,
    limit: int = Query(100, le=1000),
    offset: int = 0,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """List supplier invoices with filtering"""
    # Verify user has access to this company
    await verify_company_access(company_id, current_user, db)

    query = (
        db.query(SupplierInvoice, Supplier.name.label("supplier_name"))
        .join(Supplier, SupplierInvoice.supplier_id == Supplier.id)
        .filter(SupplierInvoice.company_id == company_id)
    )

    # Filter by fiscal year date range
    if fiscal_year_id:
        fiscal_year = db.query(FiscalYear).filter(FiscalYear.id == fiscal_year_id).first()
        if fiscal_year:
            query = query.filter(SupplierInvoice.invoice_date >= fiscal_year.start_date)
            query = query.filter(SupplierInvoice.invoice_date <= fiscal_year.end_date)

    if supplier_id:
        query = query.filter(SupplierInvoice.supplier_id == supplier_id)
    if status:
        query = query.filter(SupplierInvoice.status == status)
    if start_date:
        query = query.filter(SupplierInvoice.invoice_date >= start_date)
    if end_date:
        query = query.filter(SupplierInvoice.invoice_date <= end_date)

    results = (
        query.order_by(desc(SupplierInvoice.invoice_date), desc(SupplierInvoice.our_invoice_number))
        .limit(limit)
        .offset(offset)
        .all()
    )

    return [
        SupplierInvoiceListItem(
            id=inv.id,
            our_invoice_number=inv.our_invoice_number,
            supplier_invoice_number=inv.supplier_invoice_number,
            invoice_date=inv.invoice_date,
            due_date=inv.due_date,
            supplier_id=inv.supplier_id,
            supplier_name=supplier_name,
            total_amount=inv.total_amount,
            status=inv.status,
            payment_status=inv.payment_status,
            paid_amount=inv.paid_amount,
        )
        for inv, supplier_name in results
    ]


@router.get("/{invoice_id}", response_model=SupplierInvoiceResponse)
async def get_supplier_invoice(
    invoice_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)
):
    """Get a specific supplier invoice"""
    invoice = db.query(SupplierInvoice).filter(SupplierInvoice.id == invoice_id).first()
    if not invoice:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Supplier invoice {invoice_id} not found")

    # Verify user has access to this company
    await verify_company_access(invoice.company_id, current_user, db)

    return invoice


@router.patch("/{invoice_id}", response_model=SupplierInvoiceResponse)
async def update_supplier_invoice(
    invoice_id: int,
    invoice_update: SupplierInvoiceUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Update a supplier invoice"""
    invoice = db.query(SupplierInvoice).filter(SupplierInvoice.id == invoice_id).first()
    if not invoice:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Supplier invoice {invoice_id} not found")

    # Verify user has access to this company
    await verify_company_access(invoice.company_id, current_user, db)

    if invoice.payment_status == PaymentStatus.PAID:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot modify paid invoice")

    if invoice.status == InvoiceStatus.CANCELLED:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot modify cancelled invoice")

    update_data = invoice_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(invoice, field, value)

    db.commit()
    db.refresh(invoice)
    return invoice


@router.post("/{invoice_id}/register", response_model=SupplierInvoiceResponse)
async def register_supplier_invoice(
    invoice_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)
):
    """
    Register/post supplier invoice and create automatic verification (accrual method only).

    Accrual method creates accounting entry:
        Debit:  6xxx Expense accounts
        Debit:  2640 Ingående moms (input VAT)
        Credit: 2440 Leverantörsskulder (accounts payable)

    Cash method: No verification is created - expense is recognized on payment.
    """
    invoice = db.query(SupplierInvoice).filter(SupplierInvoice.id == invoice_id).first()
    if not invoice:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Supplier invoice {invoice_id} not found")

    # Verify user has access to this company
    await verify_company_access(invoice.company_id, current_user, db)

    if invoice.status != InvoiceStatus.DRAFT:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invoice is not in draft status")

    # Get company accounting basis
    company = db.query(Company).filter(Company.id == invoice.company_id).first()

    # Create verification only for accrual method
    if company.accounting_basis == AccountingBasis.ACCRUAL:
        verification = create_supplier_invoice_verification(db, invoice)
        invoice.invoice_verification_id = verification.id
        _propagate_invoice_attachments_to_verification(db, invoice.id, verification.id)

    # Update invoice status
    invoice.status = InvoiceStatus.ISSUED  # Registered/posted

    db.commit()
    db.refresh(invoice)

    return invoice


@router.post("/{invoice_id}/mark-paid", response_model=SupplierInvoiceResponse)
async def mark_supplier_invoice_paid(
    invoice_id: int,
    payment: MarkPaidRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Mark supplier invoice as paid and create payment verification.

    Accrual method:
        Debit:  2440 Accounts payable
        Credit: 1930 Bank account

    Cash method:
        Debit:  6xxx Expense accounts (proportional)
        Debit:  2640 Input VAT (proportional)
        Credit: 1930 Bank account
    """
    invoice = db.query(SupplierInvoice).filter(SupplierInvoice.id == invoice_id).first()
    if not invoice:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Supplier invoice {invoice_id} not found")

    # Verify user has access to this company
    await verify_company_access(invoice.company_id, current_user, db)

    if invoice.payment_status == PaymentStatus.PAID:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invoice is already paid")

    if invoice.status == InvoiceStatus.CANCELLED:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot pay cancelled invoice")

    # Get company accounting basis
    company = db.query(Company).filter(Company.id == invoice.company_id).first()

    # Handle draft invoices based on accounting method
    if invoice.status == InvoiceStatus.DRAFT:
        if company.accounting_basis == AccountingBasis.ACCRUAL:
            # Accrual: Create invoice verification first
            verification = create_supplier_invoice_verification(db, invoice)
            invoice.invoice_verification_id = verification.id
            _propagate_invoice_attachments_to_verification(db, invoice.id, verification.id)
        # Cash method: Just update status, no verification needed
        invoice.status = InvoiceStatus.ISSUED

    # Determine payment amount
    paid_amount = payment.paid_amount if payment.paid_amount else (invoice.total_amount - invoice.paid_amount)

    # Create payment verification with appropriate accounting method
    payment_verification = create_supplier_invoice_payment_verification(
        db, invoice, payment.paid_date, paid_amount, payment.bank_account_id, company.accounting_basis
    )

    if company.accounting_basis == AccountingBasis.CASH:
        _propagate_invoice_attachments_to_verification(db, invoice.id, payment_verification.id)

    # Create payment record for history
    supplier_payment = SupplierInvoicePayment(
        supplier_invoice_id=invoice.id,
        payment_date=payment.paid_date,
        amount=paid_amount,
        verification_id=payment_verification.id,
        bank_account_id=payment.bank_account_id,
        reference=payment.reference,
        notes=payment.notes,
    )
    db.add(supplier_payment)

    # Update invoice (cached values for backwards compatibility)
    invoice.paid_amount += paid_amount
    invoice.paid_date = payment.paid_date
    invoice.payment_verification_id = payment_verification.id

    # Update payment status (status stays as ISSUED)
    if invoice.paid_amount >= invoice.total_amount:
        invoice.payment_status = PaymentStatus.PAID
    else:
        invoice.payment_status = PaymentStatus.PARTIALLY_PAID

    db.commit()
    db.refresh(invoice)

    return invoice


@router.post("/{invoice_id}/cancel", response_model=SupplierInvoiceResponse)
async def cancel_supplier_invoice(
    invoice_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)
):
    """
    Cancel a supplier invoice.

    Can only cancel invoices that are:
    - In DRAFT status (no accounting impact)
    - In ISSUED status with UNPAID payment status

    Cannot cancel invoices that have received payments.
    """
    invoice = db.query(SupplierInvoice).filter(SupplierInvoice.id == invoice_id).first()
    if not invoice:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Supplier invoice {invoice_id} not found")

    # Verify user has access to this company
    await verify_company_access(invoice.company_id, current_user, db)

    if invoice.status == InvoiceStatus.CANCELLED:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invoice is already cancelled")

    if invoice.payment_status != PaymentStatus.UNPAID:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot cancel invoice with payments.",
        )

    # TODO: If invoice was ISSUED with accounting entries (accrual method),
    # we should create reversing entries. For now, just mark as cancelled.
    invoice.status = InvoiceStatus.CANCELLED

    db.commit()
    db.refresh(invoice)

    return invoice


@router.delete("/{invoice_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_supplier_invoice(
    invoice_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_active_user)
):
    """Delete a supplier invoice (only if draft or cancelled)"""
    invoice = db.query(SupplierInvoice).filter(SupplierInvoice.id == invoice_id).first()
    if not invoice:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Supplier invoice {invoice_id} not found")

    # Verify user has access to this company
    await verify_company_access(invoice.company_id, current_user, db)

    if invoice.status not in [InvoiceStatus.DRAFT, InvoiceStatus.CANCELLED]:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Can only delete draft or cancelled invoices")

    db.delete(invoice)
    db.commit()
    return None


# ============================================
# Attachment Link Endpoints
# ============================================


@router.post("/{invoice_id}/attachments", response_model=EntityAttachmentItem, status_code=status.HTTP_201_CREATED)
async def link_attachment(
    invoice_id: int,
    link_data: AttachmentLinkCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Link an existing attachment to a supplier invoice"""
    # Get invoice
    invoice = db.query(SupplierInvoice).filter(SupplierInvoice.id == invoice_id).first()
    if not invoice:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Supplier invoice {invoice_id} not found")

    # Verify user has access to invoice's company
    await verify_company_access(invoice.company_id, current_user, db)

    # Check that fiscal year is open
    fiscal_year = (
        db.query(FiscalYear)
        .filter(
            FiscalYear.company_id == invoice.company_id,
            FiscalYear.start_date <= invoice.invoice_date,
            FiscalYear.end_date >= invoice.invoice_date,
        )
        .first()
    )
    if not fiscal_year or fiscal_year.is_closed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot modify attachments when fiscal year is closed",
        )

    # Get attachment
    attachment = db.query(Attachment).filter(Attachment.id == link_data.attachment_id).first()
    if not attachment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=f"Attachment {link_data.attachment_id} not found"
        )

    # Verify user has access to attachment's company
    await verify_company_access(attachment.company_id, current_user, db)

    # Check if link already exists (idempotent)
    existing_link = (
        db.query(AttachmentLink)
        .filter(
            AttachmentLink.attachment_id == link_data.attachment_id,
            AttachmentLink.entity_type == EntityType.SUPPLIER_INVOICE,
            AttachmentLink.entity_id == invoice_id,
        )
        .first()
    )

    if existing_link:
        # Update existing link
        existing_link.role = link_data.role
        existing_link.sort_order = link_data.sort_order
        db.commit()
        db.refresh(existing_link)
        return EntityAttachmentItem(
            id=existing_link.id,
            attachment_id=existing_link.attachment_id,
            role=existing_link.role,
            sort_order=existing_link.sort_order,
            created_at=existing_link.created_at,
            original_filename=attachment.original_filename,
            mime_type=attachment.mime_type,
            size_bytes=attachment.size_bytes,
            status=attachment.status,
        )

    # Create new link
    link = AttachmentLink(
        attachment_id=link_data.attachment_id,
        entity_type=EntityType.SUPPLIER_INVOICE,
        entity_id=invoice_id,
        role=link_data.role,
        sort_order=link_data.sort_order,
    )
    db.add(link)
    db.commit()
    db.refresh(link)

    return EntityAttachmentItem(
        link_id=link.id,
        attachment_id=link.attachment_id,
        role=link.role,
        sort_order=link.sort_order,
        created_at=link.created_at,
        original_filename=attachment.original_filename,
        mime_type=attachment.mime_type,
        size_bytes=attachment.size_bytes,
        status=attachment.status,
    )


@router.get("/{invoice_id}/attachments", response_model=list[EntityAttachmentItem])
async def list_invoice_attachments(
    invoice_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """List all attachments linked to a supplier invoice"""
    # Get invoice
    invoice = db.query(SupplierInvoice).filter(SupplierInvoice.id == invoice_id).first()
    if not invoice:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Supplier invoice {invoice_id} not found")

    # Verify user has access to invoice's company
    await verify_company_access(invoice.company_id, current_user, db)

    # Get links with attachment details
    links = (
        db.query(AttachmentLink, Attachment)
        .join(Attachment, AttachmentLink.attachment_id == Attachment.id)
        .filter(
            AttachmentLink.entity_type == EntityType.SUPPLIER_INVOICE,
            AttachmentLink.entity_id == invoice_id,
        )
        .order_by(AttachmentLink.sort_order, AttachmentLink.created_at)
        .all()
    )

    return [
        EntityAttachmentItem(
            link_id=link.id,
            attachment_id=link.attachment_id,
            role=link.role,
            sort_order=link.sort_order,
            created_at=link.created_at,
            original_filename=attachment.original_filename,
            mime_type=attachment.mime_type,
            size_bytes=attachment.size_bytes,
            status=attachment.status,
        )
        for link, attachment in links
    ]


@router.delete("/{invoice_id}/attachments/{attachment_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unlink_attachment(
    invoice_id: int,
    attachment_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Unlink an attachment from a supplier invoice"""
    # Get invoice
    invoice = db.query(SupplierInvoice).filter(SupplierInvoice.id == invoice_id).first()
    if not invoice:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Supplier invoice {invoice_id} not found")

    # Verify user has access to invoice's company
    await verify_company_access(invoice.company_id, current_user, db)

    # Check that fiscal year is open
    fiscal_year = (
        db.query(FiscalYear)
        .filter(
            FiscalYear.company_id == invoice.company_id,
            FiscalYear.start_date <= invoice.invoice_date,
            FiscalYear.end_date >= invoice.invoice_date,
        )
        .first()
    )
    if not fiscal_year or fiscal_year.is_closed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Cannot modify attachments when fiscal year is closed",
        )

    # Find and delete link
    link = (
        db.query(AttachmentLink)
        .filter(
            AttachmentLink.attachment_id == attachment_id,
            AttachmentLink.entity_type == EntityType.SUPPLIER_INVOICE,
            AttachmentLink.entity_id == invoice_id,
        )
        .first()
    )

    if not link:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Attachment {attachment_id} is not linked to supplier invoice {invoice_id}",
        )

    db.delete(link)
    db.commit()

    return None
