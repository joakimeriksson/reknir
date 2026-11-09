from datetime import date, datetime, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_active_user, verify_company_access
from app.models.account import Account, AccountType
from app.models.company import Company, VATReportingPeriod
from app.models.fiscal_year import FiscalYear
from app.models.user import User
from app.models.verification import TransactionLine, Verification
from app.services import vat_report_service
from app.services.report_pdf_service import (
    generate_balance_sheet_pdf,
    generate_general_ledger_pdf,
    generate_income_statement_pdf,
)

router = APIRouter()


# Re-exported for callers that import it from here
SETTLEMENT_ACCOUNTS = vat_report_service.SETTLEMENT_ACCOUNTS


def get_fiscal_year_dates(db: Session, company_id: int, fiscal_year_id: int) -> tuple[date, date]:
    """
    Get the date range for a fiscal year.
    Returns (start_date, end_date) tuple.
    """
    fiscal_year = (
        db.query(FiscalYear).filter(FiscalYear.id == fiscal_year_id, FiscalYear.company_id == company_id).first()
    )
    if not fiscal_year:
        raise HTTPException(status_code=404, detail="Fiscal year not found")
    return fiscal_year.start_date, fiscal_year.end_date


def calculate_account_balance_from_transactions(
    db: Session,
    account_id: int,
    company_id: int,
    start_date: date,
    end_date: date,
) -> float:
    """
    Calculate an account's balance from transactions within a date range.
    Returns the net balance (sum of debit - credit).
    """
    result = (
        db.query(func.sum(TransactionLine.debit - TransactionLine.credit))
        .join(Verification, TransactionLine.verification_id == Verification.id)
        .filter(
            TransactionLine.account_id == account_id,
            Verification.company_id == company_id,
            Verification.transaction_date >= start_date,
            Verification.transaction_date <= end_date,
        )
        .scalar()
    )
    return float(result or Decimal(0))


@router.get("/general-ledger")
async def get_general_ledger(
    company_id: int = Query(..., description="Company ID"),
    fiscal_year_id: int | None = Query(None, description="Fiscal Year ID"),
    start_date: str | None = Query(None, description="Start date (YYYY-MM-DD)"),
    end_date: str | None = Query(None, description="End date (YYYY-MM-DD)"),
    account_numbers: str | None = Query(None, description="Comma-separated account numbers to filter"),
    format: str = Query("json", description="Response format: json or pdf"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Generate General Ledger (Huvudbok).
    Returns JSON summary by default, or detailed PDF when format=pdf.
    """
    await verify_company_access(company_id, current_user, db)

    if format == "pdf":
        if not fiscal_year_id:
            raise HTTPException(status_code=400, detail="fiscal_year_id is required for PDF export")

        company = db.query(Company).filter(Company.id == company_id).first()
        if not company:
            raise HTTPException(status_code=404, detail="Company not found")

        fiscal_year = (
            db.query(FiscalYear).filter(FiscalYear.id == fiscal_year_id, FiscalYear.company_id == company_id).first()
        )
        if not fiscal_year:
            raise HTTPException(status_code=404, detail="Fiscal year not found")

        pdf_bytes = generate_general_ledger_pdf(db, company, fiscal_year)
        filename = f"huvudbok_{company.org_number}_{fiscal_year.label}.pdf"
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    # Determine date range
    if fiscal_year_id:
        fiscal_year = (
            db.query(FiscalYear).filter(FiscalYear.id == fiscal_year_id, FiscalYear.company_id == company_id).first()
        )
        if not fiscal_year:
            raise HTTPException(status_code=404, detail="Fiscal year not found")
        date_start = fiscal_year.start_date
        date_end = fiscal_year.end_date
    elif start_date and end_date:
        date_start = datetime.strptime(start_date, "%Y-%m-%d").date()
        date_end = datetime.strptime(end_date, "%Y-%m-%d").date()
    else:
        # Get current fiscal year
        fiscal_year = (
            db.query(FiscalYear)
            .filter(
                FiscalYear.company_id == company_id,
                FiscalYear.start_date <= date.today(),
                FiscalYear.end_date >= date.today(),
            )
            .first()
        )
        if fiscal_year:
            date_start = fiscal_year.start_date
            date_end = fiscal_year.end_date
        else:
            # Default to current year
            date_start = date(date.today().year, 1, 1)
            date_end = date(date.today().year, 12, 31)

    # Determine fiscal year start date for proper opening balance calculation
    # Resultatkonton (class 3-8) reset to 0 at fiscal year start
    # Balanskonton (class 1-2) carry over from previous year
    fiscal_year_start = date_start
    if fiscal_year_id:
        fy = db.query(FiscalYear).filter(FiscalYear.id == fiscal_year_id).first()
        if fy:
            fiscal_year_start = fy.start_date

    # Get all accounts or filtered accounts for this fiscal year
    account_query = db.query(Account).filter(
        Account.company_id == company_id,
        Account.fiscal_year_id == fiscal_year_id if fiscal_year_id else True,
    )

    if account_numbers:
        account_nums = [int(num.strip()) for num in account_numbers.split(",")]
        account_query = account_query.filter(Account.account_number.in_(account_nums))

    accounts = account_query.order_by(Account.account_number).all()

    # For each account, calculate opening balance, transactions, and closing balance
    account_summaries = []

    for account in accounts:
        # Get all transactions for this account in the period
        transactions = (
            db.query(TransactionLine, Verification)
            .join(Verification, TransactionLine.verification_id == Verification.id)
            .filter(
                TransactionLine.account_id == account.id,
                Verification.company_id == company_id,
                Verification.transaction_date >= date_start,
                Verification.transaction_date <= date_end,
            )
            .order_by(Verification.transaction_date)
            .all()
        )

        # Determine if this is a balance sheet account (class 1-2) or income statement account (class 3-8)
        is_balance_account = account.account_number < 3000

        # Calculate opening balance based on account type
        if is_balance_account:
            # Balanskonton (1xxx-2xxx): Start with stored opening balance
            opening_balance = float(account.opening_balance or Decimal(0))

            # Add transactions from fiscal year start to period start (if period starts after fiscal year)
            if date_start > fiscal_year_start:
                pre_period_query = (
                    db.query(func.sum(TransactionLine.debit - TransactionLine.credit))
                    .join(Verification)
                    .filter(
                        TransactionLine.account_id == account.id,
                        Verification.company_id == company_id,
                        Verification.transaction_date >= fiscal_year_start,
                        Verification.transaction_date < date_start,
                    )
                    .scalar()
                )
                opening_balance += float(pre_period_query or Decimal(0))
        else:
            # Resultatkonton (3xxx-8xxx): Always start at 0 at fiscal year start
            opening_balance = 0.0

            # Add transactions from fiscal year start to period start (if period starts after fiscal year)
            if date_start > fiscal_year_start:
                pre_period_query = (
                    db.query(func.sum(TransactionLine.debit - TransactionLine.credit))
                    .join(Verification)
                    .filter(
                        TransactionLine.account_id == account.id,
                        Verification.company_id == company_id,
                        Verification.transaction_date >= fiscal_year_start,
                        Verification.transaction_date < date_start,
                    )
                    .scalar()
                )
                opening_balance += float(pre_period_query or Decimal(0))

        # Skip accounts with no transactions and no opening balance
        if not transactions and opening_balance == 0:
            continue

        # Calculate period totals
        period_debit = sum(float(t[0].debit or Decimal(0)) for t in transactions)
        period_credit = sum(float(t[0].credit or Decimal(0)) for t in transactions)

        # Closing balance = opening balance + period debit - period credit
        closing_balance = opening_balance + period_debit - period_credit

        account_summaries.append(
            {
                "account_id": account.id,
                "account_number": account.account_number,
                "account_name": account.name,
                "opening_balance": opening_balance,
                "period_debit": period_debit,
                "period_credit": period_credit,
                "closing_balance": closing_balance,
                "transaction_count": len(transactions),
            }
        )

    return {
        "company_id": company_id,
        "report_type": "general_ledger",
        "start_date": date_start.isoformat(),
        "end_date": date_end.isoformat(),
        "accounts": account_summaries,
        "account_count": len(account_summaries),
    }


@router.get("/balance-sheet")
async def get_balance_sheet(
    company_id: int = Query(..., description="Company ID"),
    fiscal_year_id: int = Query(..., description="Fiscal Year ID"),
    format: str = Query("json", description="Response format: json or pdf"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Generate Balance Sheet (Balansräkning).
    Returns JSON by default, or PDF when format=pdf.
    """
    await verify_company_access(company_id, current_user, db)

    company = db.query(Company).filter(Company.id == company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    fiscal_year = (
        db.query(FiscalYear).filter(FiscalYear.id == fiscal_year_id, FiscalYear.company_id == company_id).first()
    )
    if not fiscal_year:
        raise HTTPException(status_code=404, detail="Fiscal year not found")

    if format == "pdf":
        pdf_bytes = generate_balance_sheet_pdf(db, company, fiscal_year)
        filename = f"balansrapport_{company.org_number}_{fiscal_year.label}.pdf"
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    # JSON format (default)
    date_start, date_end = fiscal_year.start_date, fiscal_year.end_date

    accounts = (
        db.query(Account)
        .filter(Account.company_id == company_id, Account.fiscal_year_id == fiscal_year_id, Account.active.is_(True))
        .all()
    )

    assets = []
    liabilities = []
    equity = []
    revenue_total = 0.0
    expenses_total = 0.0

    for account in accounts:
        year_transactions = calculate_account_balance_from_transactions(
            db, account.id, company_id, date_start, date_end
        )

        if account.account_type == AccountType.ASSET:
            balance = float(account.opening_balance) + year_transactions
            if balance == 0:
                continue
            assets.append(
                {
                    "account_number": account.account_number,
                    "name": account.name,
                    "balance": balance,
                }
            )

        elif account.account_type == AccountType.EQUITY_LIABILITY:
            balance = -(float(account.opening_balance) + year_transactions)
            if balance == 0:
                continue
            item = {
                "account_number": account.account_number,
                "name": account.name,
                "balance": balance,
            }
            if 2000 <= account.account_number < 2100:
                equity.append(item)
            else:
                liabilities.append(item)

        elif account.account_type == AccountType.REVENUE:
            if year_transactions != 0:
                revenue_total += -year_transactions

        elif account.account_type in [
            AccountType.COST_GOODS,
            AccountType.COST_LOCAL,
            AccountType.COST_OTHER,
            AccountType.COST_PERSONNEL,
            AccountType.COST_MISC,
        ]:
            if year_transactions != 0:
                expenses_total += year_transactions

    total_assets = sum(a["balance"] for a in assets)
    total_liabilities = sum(liab["balance"] for liab in liabilities)
    total_equity = sum(eq["balance"] for eq in equity)
    current_year_result = revenue_total - expenses_total

    return {
        "company_id": company_id,
        "report_type": "balance_sheet",
        "assets": {"accounts": assets, "total": total_assets},
        "liabilities": {"accounts": liabilities, "total": total_liabilities},
        "equity": {"accounts": equity, "total": total_equity},
        "current_year_result": current_year_result,
        "total_liabilities_and_equity": total_liabilities + total_equity + current_year_result,
        "balanced": abs(total_assets - (total_liabilities + total_equity + current_year_result)) < 0.01,
    }


@router.get("/income-statement")
async def get_income_statement(
    company_id: int = Query(..., description="Company ID"),
    fiscal_year_id: int = Query(..., description="Fiscal Year ID"),
    format: str = Query("json", description="Response format: json or pdf"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Generate Income Statement (Resultaträkning).
    Returns JSON by default, or PDF when format=pdf.
    """
    await verify_company_access(company_id, current_user, db)

    if format == "pdf":
        company = db.query(Company).filter(Company.id == company_id).first()
        if not company:
            raise HTTPException(status_code=404, detail="Company not found")

        fiscal_year = (
            db.query(FiscalYear).filter(FiscalYear.id == fiscal_year_id, FiscalYear.company_id == company_id).first()
        )
        if not fiscal_year:
            raise HTTPException(status_code=404, detail="Fiscal year not found")

        pdf_bytes = generate_income_statement_pdf(db, company, fiscal_year)
        filename = f"resultatrapport_{company.org_number}_{fiscal_year.label}.pdf"
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )

    # JSON format (default)
    date_start, date_end = get_fiscal_year_dates(db, company_id, fiscal_year_id)

    accounts = (
        db.query(Account)
        .filter(
            Account.company_id == company_id,
            Account.active.is_(True),
            Account.account_type.in_(
                [
                    AccountType.REVENUE,
                    AccountType.COST_GOODS,
                    AccountType.COST_LOCAL,
                    AccountType.COST_OTHER,
                    AccountType.COST_PERSONNEL,
                    AccountType.COST_MISC,
                ]
            ),
        )
        .all()
    )

    revenue = []
    expenses = []

    for account in accounts:
        balance = calculate_account_balance_from_transactions(db, account.id, company_id, date_start, date_end)

        if balance == 0:
            continue

        item = {
            "account_number": account.account_number,
            "name": account.name,
            "balance": balance,
        }

        if account.account_type == AccountType.REVENUE:
            revenue.append(item)
        else:
            expenses.append(item)

    total_revenue = -sum(r["balance"] for r in revenue)
    total_expenses = sum(e["balance"] for e in expenses)
    profit_loss = total_revenue - total_expenses

    return {
        "company_id": company_id,
        "report_type": "income_statement",
        "revenue": {"accounts": revenue, "total": total_revenue},
        "expenses": {"accounts": expenses, "total": total_expenses},
        "profit_loss": profit_loss,
    }


@router.get("/trial-balance")
async def get_trial_balance(
    company_id: int = Query(..., description="Company ID"),
    fiscal_year_id: int = Query(..., description="Fiscal Year ID"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Generate Trial Balance (Råbalans/RAR)
    Shows all accounts with opening balance, changes, and closing balance
    """
    # Verify user has access to this company
    await verify_company_access(company_id, current_user, db)

    # Get fiscal year date range
    date_start, date_end = get_fiscal_year_dates(db, company_id, fiscal_year_id)

    accounts = (
        db.query(Account)
        .filter(Account.company_id == company_id, Account.active.is_(True))
        .order_by(Account.account_number)
        .all()
    )

    trial_balance = []
    total_debit = Decimal("0")
    total_credit = Decimal("0")

    for account in accounts:
        # Calculate opening balance (transactions before fiscal year start)
        opening_balance_result = (
            db.query(func.sum(TransactionLine.debit - TransactionLine.credit))
            .join(Verification, TransactionLine.verification_id == Verification.id)
            .filter(
                TransactionLine.account_id == account.id,
                Verification.company_id == company_id,
                Verification.transaction_date < date_start,
            )
            .scalar()
        )
        opening_balance = float(opening_balance_result or Decimal(0))

        # Calculate change during fiscal year
        change = calculate_account_balance_from_transactions(db, account.id, company_id, date_start, date_end)

        closing_balance = opening_balance + change

        item = {
            "account_number": account.account_number,
            "name": account.name,
            "account_type": account.account_type.value,
            "opening_balance": opening_balance,
            "change": change,
            "closing_balance": closing_balance,
        }

        trial_balance.append(item)

        # Sum debits and credits
        if closing_balance > 0:
            total_debit += Decimal(str(closing_balance))
        else:
            total_credit += Decimal(str(abs(closing_balance)))

    return {
        "company_id": company_id,
        "report_type": "trial_balance",
        "accounts": trial_balance,
        "total_debit": float(total_debit),
        "total_credit": float(total_credit),
        "balanced": abs(total_debit - total_credit) < 0.01,
    }


@router.get("/vat-report")
async def get_vat_report(
    company_id: int = Query(..., description="Company ID"),
    start_date: date | None = Query(None, description="Start date for VAT period (YYYY-MM-DD)"),
    end_date: date | None = Query(None, description="End date for VAT period (YYYY-MM-DD)"),
    exclude_vat_settlements: bool = Query(False, description="Exclude VAT settlement/declaration entries"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Momsrapport for a period: outgoing and incoming VAT per account, the net to pay
    or get back, and every box of the momsdeklaration (SKV 4700) derived from BAS
    account numbers (see ``vat_report_service``).

    If no dates are given, all-time totals are returned. With
    ``exclude_vat_settlements`` the verifications that move a period's VAT to the
    tax account (1630/1650/2650/2660 or described as momsredovisning) are ignored,
    so an already-settled period still shows what was declared.
    """
    await verify_company_access(company_id, current_user, db)

    lines, excluded_ids = vat_report_service.collect_lines(
        db, company_id, start_date, end_date, exclude_vat_settlements
    )
    decl = vat_report_service.build_declaration(lines)

    # Per-account summary of the VAT accounts themselves (what the ledger says)
    outgoing: dict[int, dict] = {}
    incoming: dict[int, dict] = {}
    for ln in lines:
        n = ln.account_number
        if 2610 <= n <= 2639:
            bucket, signed = outgoing, ln.credit - ln.debit
        elif 2640 <= n <= 2649:
            bucket, signed = incoming, ln.debit - ln.credit
        else:
            continue
        row = bucket.setdefault(n, {"account_number": n, "name": ln.account_name, "amount": Decimal(0)})
        row["amount"] += signed

    def _rows(bucket: dict[int, dict]) -> list[dict]:
        return [
            {"account_number": r["account_number"], "name": r["name"], "amount": float(r["amount"])}
            for _, r in sorted(bucket.items())
            if r["amount"] != 0
        ]

    total_outgoing = sum((r["amount"] for r in outgoing.values()), Decimal(0))
    total_incoming = sum((r["amount"] for r in incoming.values()), Decimal(0))
    net_vat = total_outgoing - total_incoming

    # Verifications behind the figures, for the details panel in the UI
    ver_ids = sorted({ln.verification_id for ln in lines if 2610 <= ln.account_number <= 2649})
    verification_details = []
    if ver_ids:
        verifications = (
            db.query(Verification)
            .filter(Verification.id.in_(ver_ids))
            .order_by(Verification.transaction_date.desc(), Verification.verification_number.desc())
            .all()
        )
        all_lines = (
            db.query(TransactionLine, Account)
            .join(Account, TransactionLine.account_id == Account.id)
            .filter(TransactionLine.verification_id.in_(ver_ids))
            .all()
        )
        by_ver: dict[int, list] = {}
        for tl, acc in all_lines:
            by_ver.setdefault(tl.verification_id, []).append(
                {
                    "account_number": acc.account_number,
                    "account_name": acc.name,
                    "debit": float(tl.debit),
                    "credit": float(tl.credit),
                    "is_vat_account": 2610 <= acc.account_number <= 2649,
                }
            )
        for ver in verifications:
            verification_details.append(
                {
                    "id": ver.id,
                    "verification_number": ver.verification_number,
                    "series": ver.series,
                    "transaction_date": ver.transaction_date.isoformat(),
                    "description": ver.description or "",
                    "transaction_lines": sorted(by_ver.get(ver.id, []), key=lambda r: r["account_number"]),
                }
            )

    return {
        "company_id": company_id,
        "report_type": "vat_report",
        "start_date": start_date.isoformat() if start_date else None,
        "end_date": end_date.isoformat() if end_date else None,
        "outgoing_vat": {"accounts": _rows(outgoing), "total": float(total_outgoing)},
        "incoming_vat": {"accounts": _rows(incoming), "total": float(total_incoming)},
        "net_vat": float(net_vat),
        "pay_or_refund": "pay" if net_vat > 0 else "refund" if net_vat < 0 else "zero",
        "declaration": decl.to_dict(),
        "debug_info": {
            "excluded_settlement_verifications": len(excluded_ids),
            "verifications": verification_details,
        },
    }


@router.get("/vat-periods")
async def get_vat_periods(
    company_id: int = Query(..., description="Company ID"),
    year: int = Query(..., description="Year to generate periods for (e.g., 2024)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Get all VAT reporting periods for a company in a specific year.
    Returns periods based on company's vat_reporting_period setting (monthly/quarterly/yearly).
    """
    # Verify user has access to this company
    await verify_company_access(company_id, current_user, db)
    company = db.query(Company).filter(Company.id == company_id).first()
    if not company:
        return {"error": "Company not found", "periods": []}

    periods = []

    if company.vat_reporting_period == VATReportingPeriod.MONTHLY:
        # Generate 12 monthly periods
        for month in range(1, 13):
            # Start date: first day of month
            start = date(year, month, 1)
            # End date: last day of month
            if month == 12:
                end = date(year, 12, 31)
            else:
                end = date(year, month + 1, 1) - timedelta(days=1)

            periods.append(
                {
                    "name": f"{year}-{month:02d} (Månad {month})",
                    "start_date": start.isoformat(),
                    "end_date": end.isoformat(),
                    "period_type": "monthly",
                }
            )

    elif company.vat_reporting_period == VATReportingPeriod.QUARTERLY:
        # Generate 4 quarterly periods
        quarters = [("Q1", 1, 3), ("Q2", 4, 6), ("Q3", 7, 9), ("Q4", 10, 12)]

        for quarter_name, start_month, end_month in quarters:
            start = date(year, start_month, 1)
            # End date: last day of last month in quarter
            if end_month == 12:
                end = date(year, 12, 31)
            else:
                end = date(year, end_month + 1, 1) - timedelta(days=1)

            periods.append(
                {
                    "name": f"{year} {quarter_name}",
                    "start_date": start.isoformat(),
                    "end_date": end.isoformat(),
                    "period_type": "quarterly",
                }
            )

    elif company.vat_reporting_period == VATReportingPeriod.YEARLY:
        # Generate 1 yearly period
        periods.append(
            {
                "name": f"{year} (Helår)",
                "start_date": date(year, 1, 1).isoformat(),
                "end_date": date(year, 12, 31).isoformat(),
                "period_type": "yearly",
            }
        )

    return {
        "company_id": company_id,
        "year": year,
        "reporting_period": company.vat_reporting_period.value,
        "periods": periods,
    }


@router.get("/vat-report-xml")
async def export_vat_report_xml(
    company_id: int = Query(..., description="Company ID"),
    start_date: date = Query(..., description="Start date for VAT period (YYYY-MM-DD)"),
    end_date: date = Query(..., description="End date for VAT period (YYYY-MM-DD)"),
    exclude_vat_settlements: bool = Query(True, description="Exclude VAT settlement/declaration entries"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    The period's momsdeklaration as an eSKDUpload 6.0 file for upload at Skatteverket.

    Amounts are whole kronor with the öre dropped and box 49 is the sum of the
    rounded VAT boxes, exactly as Skatteverket (and Bokio) compute it.
    """
    await verify_company_access(company_id, current_user, db)

    company = db.query(Company).filter(Company.id == company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    lines, _ = vat_report_service.collect_lines(db, company_id, start_date, end_date, exclude_vat_settlements)
    decl = vat_report_service.build_declaration(lines)
    full_xml = vat_report_service.eskd_xml(company.org_number or "", end_date, decl)

    filename = f"momsdeklaration_{company.org_number}_{end_date:%Y%m}.xml"
    return Response(
        content=full_xml.encode("utf-8"),
        media_type="application/xml",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.get("/monthly-statistics")
def get_monthly_statistics(
    company_id: int = Query(..., description="Company ID"),
    year: int = Query(..., description="Year (e.g., 2024)"),
    db: Session = Depends(get_db),
):
    """
    Get monthly revenue and expense statistics for a specific year.
    Used for dashboard charts to visualize financial performance over time.
    """
    # Get all revenue accounts (3000-3999)
    revenue_accounts = (
        db.query(Account)
        .filter(Account.company_id == company_id, Account.account_number >= 3000, Account.account_number < 4000)
        .all()
    )

    # Get all expense accounts (4000-8999)
    expense_accounts = (
        db.query(Account)
        .filter(Account.company_id == company_id, Account.account_number >= 4000, Account.account_number < 9000)
        .all()
    )

    revenue_account_ids = [acc.id for acc in revenue_accounts]
    expense_account_ids = [acc.id for acc in expense_accounts]

    monthly_data = []

    # Calculate for each month
    for month in range(1, 13):
        # Start and end dates for the month
        start_date = date(year, month, 1)
        if month == 12:
            end_date = date(year, 12, 31)
        else:
            end_date = date(year, month + 1, 1) - timedelta(days=1)

        # Get all transactions for revenue accounts in this month
        if revenue_account_ids:
            revenue_trans = (
                db.query(func.sum(TransactionLine.credit - TransactionLine.debit).label("total"))
                .join(Verification, TransactionLine.verification_id == Verification.id)
                .filter(
                    Verification.company_id == company_id,
                    Verification.transaction_date >= start_date,
                    Verification.transaction_date <= end_date,
                    TransactionLine.account_id.in_(revenue_account_ids),
                )
                .scalar()
            )
        else:
            revenue_trans = 0

        # Get all transactions for expense accounts in this month
        if expense_account_ids:
            expense_trans = (
                db.query(func.sum(TransactionLine.debit - TransactionLine.credit).label("total"))
                .join(Verification, TransactionLine.verification_id == Verification.id)
                .filter(
                    Verification.company_id == company_id,
                    Verification.transaction_date >= start_date,
                    Verification.transaction_date <= end_date,
                    TransactionLine.account_id.in_(expense_account_ids),
                )
                .scalar()
            )
        else:
            expense_trans = 0

        revenue = float(revenue_trans or 0)
        expenses = float(expense_trans or 0)
        profit = revenue - expenses

        monthly_data.append(
            {
                "month": month,
                "month_name": start_date.strftime("%b"),  # Jan, Feb, etc.
                "revenue": revenue,
                "expenses": expenses,
                "profit": profit,
            }
        )

    # Calculate year-to-date totals
    ytd_revenue = sum(m["revenue"] for m in monthly_data)
    ytd_expenses = sum(m["expenses"] for m in monthly_data)
    ytd_profit = ytd_revenue - ytd_expenses

    return {
        "company_id": company_id,
        "year": year,
        "monthly_data": monthly_data,
        "ytd_totals": {"revenue": ytd_revenue, "expenses": ytd_expenses, "profit": ytd_profit},
    }


# =============================================================================
# Aging (åldersanalys) and cash flow (kassaflödesanalys)
# =============================================================================


@router.get("/aging")
async def get_aging_report(
    company_id: int = Query(..., description="Company ID"),
    kind: str = Query("customer", pattern="^(customer|supplier)$", description="customer (kundreskontra) or supplier"),
    as_of: str | None = Query(None, description="Date (YYYY-MM-DD), default today"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Open invoices per counterpart, bucketed by days overdue as of a date."""
    from app.models.customer import Customer, Supplier
    from app.models.invoice import Invoice, InvoiceStatus, PaymentStatus, SupplierInvoice

    await verify_company_access(company_id, current_user, db)
    ref_date = datetime.strptime(as_of, "%Y-%m-%d").date() if as_of else date.today()
    buckets = [
        ("not_due", "Ej förfallet"),
        ("d1_30", "1–30 dagar"),
        ("d31_60", "31–60 dagar"),
        ("d61_90", "61–90 dagar"),
        ("d90_plus", "> 90 dagar"),
    ]

    if kind == "customer":
        rows = (
            db.query(Invoice, Customer.name)
            .join(Customer, Customer.id == Invoice.customer_id)
            .filter(
                Invoice.company_id == company_id,
                Invoice.status == InvoiceStatus.ISSUED,
                Invoice.payment_status != PaymentStatus.PAID,
                Invoice.invoice_date <= ref_date,
            )
            .all()
        )
        items = [(inv, name, f"{inv.invoice_series}{inv.invoice_number}") for inv, name in rows]
    else:
        rows = (
            db.query(SupplierInvoice, Supplier.name)
            .join(Supplier, Supplier.id == SupplierInvoice.supplier_id)
            .filter(
                SupplierInvoice.company_id == company_id,
                SupplierInvoice.status != InvoiceStatus.CANCELLED,
                SupplierInvoice.payment_status != PaymentStatus.PAID,
                SupplierInvoice.invoice_date <= ref_date,
            )
            .all()
        )
        items = [(inv, name, inv.supplier_invoice_number) for inv, name in rows]

    def bucket_of(days_overdue: int) -> str:
        if days_overdue <= 0:
            return "not_due"
        if days_overdue <= 30:
            return "d1_30"
        if days_overdue <= 60:
            return "d31_60"
        if days_overdue <= 90:
            return "d61_90"
        return "d90_plus"

    per_party: dict[str, dict] = {}
    totals = {key: Decimal("0") for key, _ in buckets}
    invoices_out = []
    for inv, party, label in items:
        open_amount = Decimal(inv.total_amount) - Decimal(inv.paid_amount or 0)
        if open_amount <= 0:
            continue
        days = (ref_date - inv.due_date).days
        key = bucket_of(days)
        entry = per_party.setdefault(
            party, {"name": party, "total": Decimal("0"), **{k: Decimal("0") for k, _ in buckets}}
        )
        entry[key] += open_amount
        entry["total"] += open_amount
        totals[key] += open_amount
        invoices_out.append(
            {
                "id": inv.id,
                "number": label,
                "party": party,
                "invoice_date": inv.invoice_date.isoformat(),
                "due_date": inv.due_date.isoformat(),
                "days_overdue": max(days, 0),
                "open_amount": float(open_amount),
                "bucket": key,
            }
        )

    return {
        "kind": kind,
        "as_of": ref_date.isoformat(),
        "buckets": [{"key": k, "label": lbl, "amount": float(totals[k])} for k, lbl in buckets],
        "total": float(sum(totals.values())),
        "parties": sorted(
            [{**p, "total": float(p["total"]), **{k: float(p[k]) for k, _ in buckets}} for p in per_party.values()],
            key=lambda p: -p["total"],
        ),
        "invoices": sorted(invoices_out, key=lambda i: (-i["days_overdue"], i["party"])),
    }


@router.get("/cash-flow")
async def get_cash_flow(
    company_id: int = Query(..., description="Company ID"),
    fiscal_year_id: int = Query(..., description="Fiscal Year ID"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """Monthly cash flow, direct method: movements on cash accounts (19xx) grouped by
    what they were posted against. Opening balance is the sum of the cash accounts'
    opening balances."""
    await verify_company_access(company_id, current_user, db)
    start_date, end_date = get_fiscal_year_dates(db, company_id, fiscal_year_id)

    cash_accounts = (
        db.query(Account)
        .filter(
            Account.company_id == company_id,
            Account.fiscal_year_id == fiscal_year_id,
            Account.account_number >= 1900,
            Account.account_number <= 1999,
        )
        .all()
    )
    cash_ids = {a.id for a in cash_accounts}
    opening = sum((Decimal(a.opening_balance) for a in cash_accounts), Decimal("0"))

    categories = [
        ("sales", "Försäljning och kundbetalningar", lambda n: 3000 <= n <= 3999 or n == 1510),
        ("purchases", "Inköp och leverantörsbetalningar", lambda n: 4000 <= n <= 6999 or n == 2440),
        ("personnel", "Personal och utlägg", lambda n: 7000 <= n <= 7999 or n in (2890, 2710, 2730)),
        ("vat_tax", "Moms och skatter", lambda n: 2600 <= n <= 2699 or n in (1630, 2510, 2514)),
        ("financing", "Finansiering och eget kapital", lambda n: 2000 <= n <= 2399 or 8000 <= n <= 8999),
        ("investments", "Investeringar", lambda n: 1000 <= n <= 1399),
        ("other", "Övrigt", lambda n: True),
    ]

    def categorize(counter_numbers: list[int]) -> str:
        for key, _label, match in categories:
            if any(match(n) for n in counter_numbers):
                return key
        return "other"

    verifications = (
        db.query(Verification)
        .filter(
            Verification.company_id == company_id,
            Verification.fiscal_year_id == fiscal_year_id,
            Verification.transaction_date >= start_date,
            Verification.transaction_date <= end_date,
        )
        .all()
    )
    months: dict[str, dict] = {}
    for v in verifications:
        cash_delta = Decimal("0")
        counter = []
        for line in v.transaction_lines:
            if line.account_id in cash_ids:
                cash_delta += Decimal(line.debit) - Decimal(line.credit)
            else:
                counter.append(line.account.account_number)
        if cash_delta == 0:
            continue
        key = v.transaction_date.strftime("%Y-%m")
        month = months.setdefault(
            key,
            {
                "month": key,
                "inflow": Decimal("0"),
                "outflow": Decimal("0"),
                "by_category": {c[0]: Decimal("0") for c in categories},
            },
        )
        if cash_delta > 0:
            month["inflow"] += cash_delta
        else:
            month["outflow"] += -cash_delta
        month["by_category"][categorize(counter)] += cash_delta

    running = opening
    out_months = []
    for key in sorted(months):
        m = months[key]
        net = m["inflow"] - m["outflow"]
        running += net
        out_months.append(
            {
                "month": key,
                "inflow": float(m["inflow"]),
                "outflow": float(m["outflow"]),
                "net": float(net),
                "closing": float(running),
                "by_category": {k: float(v) for k, v in m["by_category"].items()},
            }
        )
    return {
        "fiscal_year_id": fiscal_year_id,
        "start_date": start_date.isoformat(),
        "end_date": end_date.isoformat(),
        "cash_accounts": [a.account_number for a in cash_accounts],
        "opening": float(opening),
        "closing": float(running),
        "categories": [{"key": k, "label": lbl} for k, lbl, _ in categories],
        "months": out_months,
    }
