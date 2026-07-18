import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import __version__
from app.config import settings
from app.routers import (
    accounts,
    ai_assistant,
    attachments,
    auth,
    backup,
    companies,
    customers,
    dashboard,
    default_accounts,
    expenses,
    fiscal_years,
    invitations,
    invoices,
    posting_templates,
    reports,
    sie4,
    supplier_invoices,
    suppliers,
    system,
    verifications,
)
from app.services.backup_scheduler import backup_scheduler_loop


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(backup_scheduler_loop())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


# Create FastAPI application
app = FastAPI(
    title=settings.app_name,
    description="Modern Swedish bookkeeping system with BAS kontoplan support and invoice management",
    version=__version__,
    lifespan=lifespan,
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
# Authentication (no prefix, already set in router)
app.include_router(auth.router)

# System info (no prefix, already set in router)
app.include_router(system.router)

# Invitations (no prefix, already set in router)
app.include_router(invitations.router)

# Dashboard (no prefix, already set in router)
app.include_router(dashboard.router)

app.include_router(companies.router, prefix="/api/companies", tags=["companies"])
app.include_router(fiscal_years.router, prefix="/api/fiscal-years", tags=["fiscal-years"])
app.include_router(accounts.router, prefix="/api/accounts", tags=["accounts"])
app.include_router(verifications.router, prefix="/api/verifications", tags=["verifications"])
app.include_router(posting_templates.router, prefix="/api/posting-templates", tags=["posting-templates"])
app.include_router(reports.router, prefix="/api/reports", tags=["reports"])

# Invoice management routers
app.include_router(customers.router, prefix="/api/customers", tags=["customers"])
app.include_router(suppliers.router, prefix="/api/suppliers", tags=["suppliers"])
app.include_router(invoices.router, prefix="/api/invoices", tags=["invoices"])
app.include_router(supplier_invoices.router, prefix="/api/supplier-invoices", tags=["supplier-invoices"])

# Expense management
app.include_router(expenses.router, prefix="/api/expenses", tags=["expenses"])

# Attachment management
app.include_router(attachments.router, prefix="/api/attachments", tags=["attachments"])

# SIE4 import/export and default accounts
app.include_router(sie4.router)
app.include_router(default_accounts.router)

# Backup and restore
app.include_router(backup.router, prefix="/api/backup", tags=["backup"])

# AI assistant
app.include_router(ai_assistant.router, prefix="/api/ai", tags=["ai-assistant"])


@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "message": "Reknir API",
        "version": __version__,
        "features": [
            "Swedish BAS kontoplan",
            "Double-entry bookkeeping",
            "Invoice management (outgoing & incoming)",
            "Automatic verification creation",
            "SIE4 import/export",
            "Configurable default accounts",
            "Reports",
        ],
        "docs": "/docs",
    }


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy"}
