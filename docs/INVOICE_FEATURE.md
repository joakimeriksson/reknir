# Invoice Management Feature - Implementation Summary

**Date**: 2024-12-22 (Updated)
**Status**: ✅ Complete
**Version**: 1.2.0

## Overview

Complete invoice management system for Swedish bookkeeping with automatic verification creation for both outgoing (customer) and incoming (supplier) invoices.

## Features Implemented

### 📤 Outgoing Invoices (Kundfakturor)

**Customer Management**:
- Full CRUD for customer register
- Customer details: name, org number, contact info, address
- Payment terms configuration
- Active/inactive status

**Invoice Creation**:
- Sequential invoice numbering per series
- Multiple invoice lines with VAT calculation
- VAT rates: 25%, 12%, 6%, 0% (exempt)
- Revenue account assignment per line
- Customer reference and notes
- Automatic totals calculation

**Invoice Workflow**:
1. **Draft** → Create invoice
2. **Send** → Automatic verification created:
   ```
   Debit:  1510 Kundfordringar (Customer receivables)
   Credit: 3xxx Revenue accounts (per line)
   Credit: 26xx Utgående moms (Output VAT by rate)
   ```
3. **Mark Paid** → Payment verification created:
   ```
   Debit:  1930 Företagskonto (Bank account)
   Credit: 1510 Kundfordringar
   ```

**Status Tracking**:
- Draft - Not sent yet
- Sent - Invoice sent, awaiting payment
- Partial - Partially paid
- Paid - Fully paid
- Overdue - Past due date (calculated in frontend based on due_date < today)
- Cancelled - Cancelled invoice

**Overdue Highlighting**:
- Invoices with status SENT or PARTIAL and due_date < today are highlighted with red background
- Status badge changes to "OVERDUE" for visual indication

### 📥 Incoming Invoices (Leverantörsfakturor)

**Supplier Management**:
- Full CRUD for supplier register
- Supplier details including structured payment info (bankgiro, plusgiro, bank account, IBAN/BIC)
- Payment terms
- Active/inactive status

**Invoice Registration**:
- Supplier invoice number tracking
- Internal tracking number (sequential)
- Multiple invoice lines with expense categorization
- VAT extraction (ingående moms)
- OCR number support
- Attachment upload/download for scanned invoices (PDF, JPG, PNG supported)

**Invoice Workflow**:
1. **Draft** → Register invoice details
2. **Register** → Automatic verification created:
   ```
   Debit:  6xxx Expense accounts (per line)
   Debit:  2640 Ingående moms (Input VAT)
   Credit: 2440 Leverantörsskulder (Accounts payable)
   ```
3. **Mark Paid** → Payment verification created:
   ```
   Debit:  2440 Leverantörsskulder
   Credit: 1930 Företagskonto (Bank account)
   ```

## Database Schema

### New Tables

**customers**: Customer register
**suppliers**: Supplier register
**invoices**: Outgoing invoices
**invoice_lines**: Outgoing invoice line items
**supplier_invoices**: Incoming invoices
**supplier_invoice_lines**: Incoming invoice line items

### Key Fields

**Invoice**:
- Automatic invoice numbering
- VAT calculation and tracking
- Payment status and amounts
- Links to verifications (invoice + payment)
- Timestamps for audit trail

**Invoice Lines**:
- Quantity, unit price, VAT rate
- Account assignment for proper categorization
- Calculated totals (net, VAT, total)

## API Endpoints

### Customers
```
GET    /api/customers/              List customers
POST   /api/customers/              Create customer
GET    /api/customers/{id}          Get customer
PATCH  /api/customers/{id}          Update customer
DELETE /api/customers/{id}          Delete customer
```

### Suppliers
```
GET    /api/suppliers/              List suppliers
POST   /api/suppliers/              Create supplier
GET    /api/suppliers/{id}          Get supplier
PATCH  /api/suppliers/{id}          Update supplier
DELETE /api/suppliers/{id}          Delete supplier
```

### Outgoing Invoices
```
GET    /api/invoices/               List invoices (supports fiscal_year_id filter)
POST   /api/invoices/               Create invoice
GET    /api/invoices/{id}           Get invoice
PATCH  /api/invoices/{id}           Update invoice
POST   /api/invoices/{id}/send      Send invoice (create verification)
POST   /api/invoices/{id}/mark-paid Mark as paid (create payment verification)
GET    /api/invoices/{id}/pdf       Download invoice as PDF
DELETE /api/invoices/{id}           Delete draft invoice
```

### Supplier Invoices
```
GET    /api/supplier-invoices/                     List supplier invoices (supports fiscal_year_id filter)
POST   /api/supplier-invoices/                     Create supplier invoice
GET    /api/supplier-invoices/{id}                 Get supplier invoice
PATCH  /api/supplier-invoices/{id}                 Update supplier invoice
POST   /api/supplier-invoices/{id}/register        Register (create verification)
POST   /api/supplier-invoices/{id}/mark-paid       Mark as paid (create payment)
POST   /api/supplier-invoices/{id}/attachments     Link existing attachment to invoice
GET    /api/supplier-invoices/{id}/attachments     List linked attachments
DELETE /api/supplier-invoices/{id}/attachments/{attachment_id} Unlink attachment
DELETE /api/supplier-invoices/{id}                 Delete draft invoice
```

## Business Logic

### Automatic Verification Creation

**Service Layer** (`app/services/invoice_service.py`):
- `create_invoice_verification()` - Outgoing invoice posting
- `create_invoice_payment_verification()` - Outgoing payment
- `create_supplier_invoice_verification()` - Incoming invoice posting
- `create_supplier_invoice_payment_verification()` - Incoming payment

**Key Features**:
- Automatic account lookup (1510, 2440, 2640, 26xx)
- VAT splitting by rate
- Account balance updates
- Error handling for missing accounts

### VAT Handling

**Output VAT (Outgoing Invoices)**:
- Automatic mapping to correct VAT accounts:
  - 25% → 2611 (Utgående moms 25%)
  - 12% → 2612 (Utgående moms 12%)
  - 6% → 2613 (Utgående moms 6%)

**Input VAT (Supplier Invoices)**:
- All input VAT → 2640 (Ingående moms)
- Deductible from output VAT

### Accounting Basis Support

**Accrual Method (Faktureringsmetoden)**:
- Invoice verification created when invoice is sent
- Payment verification created when payment is received

**Cash Method (Kontantmetoden)**:
- No verification on send (only marks invoice as sent)
- Single verification created on payment (revenue + VAT booked at payment time)

## Frontend Integration

**Pages**:
- `/invoices` - Main invoice list with tabs for customer and supplier invoices
- `/invoices/:id` - Customer invoice detail view
- `/supplier-invoices/:id` - Supplier invoice detail view

**Navigation**: Added "Fakturor" menu item

**Features**:
- List view for outgoing invoices with fiscal year filtering
- List view for supplier invoices with fiscal year filtering
- Invoice creation modal with full form (customer, dates, lines, VAT)
- Supplier invoice creation modal
- Invoice detail views with line items and summary
- Status badges with color coding (draft=gray, sent=blue, paid=green, partial=yellow, overdue=red)
- Overdue highlighting (red background for past-due invoices)
- Swedish currency formatting
- Send invoice confirmation modal (with accounting basis info)
- Register supplier invoice confirmation modal
- Payment marking modal with date picker
- PDF download button for customer invoices
- Attachment upload/download for supplier invoices

**API Integration**:
- TypeScript types for all invoice entities
- Complete API client methods
- Error handling with Swedish messages

## Swedish Accounting Compliance

✅ **Proper Account Usage**:
- 1510 Kundfordringar (Customer receivables)
- 2440 Leverantörsskulder (Accounts payable)
- 2640 Ingående moms (Input VAT)
- 2611-2613 Utgående moms (Output VAT)
- 3xxx Revenue accounts
- 6xxx Expense accounts

✅ **Double-Entry Bookkeeping**:
- All automatic verifications balance
- Debit = Credit enforced

✅ **Audit Trail**:
- Links to verification IDs
- Timestamps on all changes
- Cannot modify paid invoices

## Example Workflow

### Creating and Paying an Outgoing Invoice

**1. Create Customer**:
```bash
POST /api/customers/
{
  "company_id": 1,
  "name": "Acme AB",
  "org_number": "556677-8899",
  "payment_terms_days": 30
}
```

**2. Create Invoice**:
```bash
POST /api/invoices/
{
  "company_id": 1,
  "customer_id": 1,
  "invoice_date": "2024-11-09",
  "due_date": "2024-12-09",
  "invoice_lines": [
    {
      "description": "Consulting services",
      "quantity": 10,
      "unit": "tim",
      "unit_price": 1000,
      "vat_rate": 25,
      "account_id": 20  // Account 3000 (Revenue)
    }
  ]
}
```

**Result**: Invoice draft created with total 12,500 SEK (10,000 + 2,500 VAT)

**3. Send Invoice**:
```bash
POST /api/invoices/1/send
```

**Result**: Verification created automatically:
```
Ver A-1  2024-11-09  Faktura F1 - Acme AB
  1510  Kundfordringar              12,500  (Debit)
  3000  Försäljning                          10,000  (Credit)
  2611  Utgående moms 25%                     2,500  (Credit)
```

**4. Mark as Paid**:
```bash
POST /api/invoices/1/mark-paid
{
  "paid_date": "2024-12-09"
}
```

**Result**: Payment verification created:
```
Ver A-2  2024-12-09  Betalning faktura F1 - Acme AB
  1930  Företagskonto              12,500  (Debit)
  1510  Kundfordringar                      12,500  (Credit)
```

## File Structure

```
backend/
├── app/
│   ├── models/
│   │   ├── customer.py          # Customer & Supplier models
│   │   └── invoice.py           # Invoice models
│   ├── schemas/
│   │   ├── customer.py          # Customer & Supplier schemas
│   │   └── invoice.py           # Invoice schemas
│   ├── routers/
│   │   ├── customers.py         # Customer endpoints
│   │   ├── suppliers.py         # Supplier endpoints
│   │   ├── invoices.py          # Invoice endpoints + PDF
│   │   └── supplier_invoices.py # Supplier invoice endpoints + attachments
│   ├── services/
│   │   ├── invoice_service.py   # Business logic
│   │   └── pdf_service.py       # PDF generation with WeasyPrint
│   └── templates/
│       └── invoice_template.html # Swedish invoice PDF template
└── alembic/versions/
    └── 002_add_invoices.py      # Database migration

frontend/
├── src/
│   ├── types/index.ts           # TypeScript types
│   ├── services/api.ts          # API client
│   └── pages/
│       ├── Invoices.tsx         # Invoice list + create modals
│       ├── InvoiceDetail.tsx    # Customer invoice detail view
│       └── SupplierInvoiceDetail.tsx  # Supplier invoice detail view
```

## Implementation Status

### Phase 1: UI Completion ✅
- [x] Invoice creation form (modal with all fields)
- [x] Customer/supplier management (via API, basic UI)
- [x] Invoice detail view (InvoiceDetail.tsx, SupplierInvoiceDetail.tsx)
- [x] Edit draft invoices (via PATCH endpoint)
- [x] Payment marking UI (modal with date picker)

### Phase 2: PDF Generation ✅
- [x] Swedish invoice PDF template (invoice_template.html)
- [x] PDF download endpoint (GET /invoices/{id}/pdf)
- [x] Archived PDF on send (immutable copy for bookkeeping compliance)
- [ ] Email sending integration

### Phase 3: Advanced Features (Future)
- [ ] Credit invoices (kreditfaktura)
- [ ] Recurring invoices
- [ ] Invoice templates
- [ ] Batch payment import
- [x] Overdue tracking (frontend calculation + highlighting)
- [ ] Overdue reminders/notifications
- [ ] OCR for supplier invoices
- [ ] AI-powered expense categorization

### Phase 4: Integration (Future)
- [ ] E-invoicing (Peppol)
- [ ] Direct bank integration
- [ ] Accounting software export (Fortnox, Visma)

## Testing

**API Testing**:
- All endpoints documented in FastAPI /docs
- Test via Swagger UI at http://localhost:8000/docs

**Required Accounts** (from BAS import):
- 1510 Kundfordringar
- 1930 Företagskonto
- 2440 Leverantörsskulder
- 2611 Utgående moms 25%
- 2612 Utgående moms 12%
- 2613 Utgående moms 6%
- 2640 Ingående moms
- 3000 Försäljning (or other 3xxx)
- 6xxx Expense accounts

## Performance Notes

- Invoice numbering uses database queries (could be optimized with sequences)
- Verification creation is transactional (atomic)
- Account balance updates happen inline (consider async for scale)
- No caching implemented yet

## Known Limitations

- No email sending (invoices must be downloaded as PDF and sent manually)
- No recurring invoices
- No credit invoices (kreditfaktura)
- No invoice templates/presets
- No OCR for supplier invoices (manual entry required)
- Overdue status is calculated in frontend only (not persisted in database)

## Success Metrics

✅ Create and track customer invoices
✅ Automatic accounting entries on invoice send
✅ Payment tracking with automatic entries
✅ Supplier invoice management
✅ VAT calculation and tracking
✅ Full API coverage
✅ TypeScript types and API client
✅ PDF generation and download
✅ Archived PDF for bookkeeping compliance
✅ Complete UI with create/view/pay workflows
✅ Overdue invoice highlighting
✅ Fiscal year filtering
✅ Supplier invoice attachments

**Invoice system is fully production-ready!**

---

## Migration

Run database migration:
```bash
docker-compose exec backend alembic upgrade head
```

Or manually:
```bash
cd backend
alembic upgrade head
```

This creates all invoice tables and enums.

## Summary

Complete invoice management system implemented with:
- ✅ Full database schema
- ✅ Complete API endpoints
- ✅ Automatic verification creation
- ✅ Swedish compliance
- ✅ Complete frontend UI (list, detail, create, pay)
- ✅ PDF generation with Swedish template
- ✅ Archived PDF for compliance (immutable copy linked to verification)
- ✅ Overdue tracking and highlighting
- ✅ Fiscal year support
- ✅ Supplier invoice attachments

**Fully production-ready for real business use!**
