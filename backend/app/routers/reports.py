import xml.etree.ElementTree as ET
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
from app.services.report_pdf_service import (
    generate_balance_sheet_pdf,
    generate_general_ledger_pdf,
    generate_income_statement_pdf,
)

router = APIRouter()


# Accounts that only appear when VAT is settled against Skatteverket (see get_vat_report)
SETTLEMENT_ACCOUNTS = [1630, 1650, 2650, 2660]


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
    Generate VAT Report (Momsrapport) for a specific period
    Shows outgoing VAT (sales) and incoming VAT (purchases) with net amount to pay/refund

    If no dates provided, shows all-time totals.
    If exclude_vat_settlements is True, filters out verifications that appear to be VAT settlements
    (e.g., entries that zero out VAT accounts when filing declarations).
    """
    # Verify user has access to this company
    await verify_company_access(company_id, current_user, db)

    # Get all VAT accounts according to Swedish BAS account plan:
    # - Outgoing VAT (from sales): 2610-2619
    # - Incoming VAT (from purchases): 2640-2649
    # Note: We don't filter on active=True because we want to include inactive accounts
    # that still have transactions (e.g., from imported historical data)
    vat_accounts = (
        db.query(Account)
        .filter(
            Account.company_id == company_id,
            (
                # Outgoing VAT accounts
                ((Account.account_number >= 2610) & (Account.account_number <= 2619))
                |
                # Incoming VAT accounts
                ((Account.account_number >= 2640) & (Account.account_number <= 2649))
            ),
        )
        .all()
    )

    # Debug logging
    import logging

    logger = logging.getLogger(__name__)
    logger.info(f"VAT Report - Found {len(vat_accounts)} VAT accounts for company {company_id}")
    for acc in vat_accounts:
        logger.info(f"  VAT Account: {acc.account_number} - {acc.name}")

    # Categorize accounts
    outgoing_vat_accounts = [acc for acc in vat_accounts if 2610 <= acc.account_number <= 2619]
    incoming_vat_accounts = [acc for acc in vat_accounts if 2640 <= acc.account_number <= 2649]

    logger.info(f"VAT Report - {len(outgoing_vat_accounts)} outgoing, {len(incoming_vat_accounts)} incoming")
    logger.info(f"VAT Report - Date filter: {start_date} to {end_date}")

    # Build query for transactions
    query = (
        db.query(
            TransactionLine.account_id,
            func.sum(TransactionLine.debit).label("total_debit"),
            func.sum(TransactionLine.credit).label("total_credit"),
        )
        .join(Verification, TransactionLine.verification_id == Verification.id)
        .filter(Verification.company_id == company_id, TransactionLine.account_id.in_([acc.id for acc in vat_accounts]))
    )

    # Apply date filters if provided
    if start_date:
        query = query.filter(Verification.transaction_date >= start_date)
    if end_date:
        query = query.filter(Verification.transaction_date <= end_date)

    # Exclude VAT settlement verifications if requested
    if exclude_vat_settlements:
        # Filter out verifications that appear to be VAT settlements/declarations
        # Strategy: Exclude verifications that contain BOTH VAT accounts (2610-2649)
        # AND VAT receivable/payable accounts (2650, 2660)
        # These are typically used when settling VAT with Skatteverket

        # A settlement moves the period's VAT from the 26xx accounts to the tax account
        # side: 1630 Skattekonto, 1650 Momsfordran, 2650 Redovisningskonto för moms,
        # 2660 Särskilda punktskatter/momsskuld. Bokio books 1650/2640/3740, other
        # programs 2650 or 1630 directly, so all of them count. Descriptions that say
        # momsredovisning/momsdeklaration are treated the same way.
        settlement_account_ids = [
            acc.id
            for acc in db.query(Account.id)
            .filter(Account.company_id == company_id, Account.account_number.in_(SETTLEMENT_ACCOUNTS))
            .all()
        ]
        settlement_ver_ids: set[int] = set()
        if settlement_account_ids:
            settlement_ver_ids.update(
                v.verification_id
                for v in db.query(TransactionLine.verification_id)
                .filter(TransactionLine.account_id.in_(settlement_account_ids))
                .distinct()
                .all()
            )
        settlement_ver_ids.update(
            v.id
            for v in db.query(Verification.id)
            .filter(
                Verification.company_id == company_id,
                Verification.description.ilike("%momsredovisning%")
                | Verification.description.ilike("%momsdeklaration%")
                | Verification.description.ilike("%momsavräkning%"),
            )
            .all()
        )
        if settlement_ver_ids:
            query = query.filter(~Verification.id.in_(list(settlement_ver_ids)))
            logger.info(f"VAT Report - Excluding {len(settlement_ver_ids)} settlement verifications")

    query = query.group_by(TransactionLine.account_id)

    transactions = query.all()

    logger.info(f"VAT Report - Found {len(transactions)} transaction groups")

    # Get account details for all transactions (even those not in our VAT ranges)
    all_account_ids = [t.account_id for t in transactions]
    all_trans_accounts = db.query(Account).filter(Account.id.in_(all_account_ids)).all()
    trans_accounts_by_id = {acc.id: acc for acc in all_trans_accounts}

    for trans in transactions:
        acc = trans_accounts_by_id.get(trans.account_id)
        if acc:
            logger.info(
                f"  Account {acc.account_number} ({acc.name}): Debit={trans.total_debit}, Credit={trans.total_credit}"
            )

    # Process outgoing VAT (credit balance = sales tax collected)
    outgoing_vat = []
    total_outgoing = Decimal("0")

    # Track by VAT rate for SKV 3800 form
    outgoing_by_rate = {
        "25": {"vat": Decimal("0"), "accounts": []},
        "12": {"vat": Decimal("0"), "accounts": []},
        "6": {"vat": Decimal("0"), "accounts": []},
    }

    for account in outgoing_vat_accounts:
        # Find transactions for this account
        trans = next((t for t in transactions if t.account_id == account.id), None)

        if trans:
            # Outgoing VAT is credit (negative), so credit - debit gives positive amount
            vat_amount = (trans.total_credit or Decimal("0")) - (trans.total_debit or Decimal("0"))

            if vat_amount != 0:
                outgoing_vat.append(
                    {"account_number": account.account_number, "name": account.name, "amount": float(vat_amount)}
                )
                total_outgoing += vat_amount

                # Categorize by VAT rate based on account number
                # 2611: 25%, 2621: 12%, 2631/2615: 6%
                if account.account_number == 2611:
                    outgoing_by_rate["25"]["vat"] += vat_amount
                    outgoing_by_rate["25"]["accounts"].append(account.account_number)
                elif account.account_number == 2621:
                    outgoing_by_rate["12"]["vat"] += vat_amount
                    outgoing_by_rate["12"]["accounts"].append(account.account_number)
                elif account.account_number in [2631, 2615]:
                    outgoing_by_rate["6"]["vat"] += vat_amount
                    outgoing_by_rate["6"]["accounts"].append(account.account_number)

    # Process incoming VAT (debit balance = purchase tax paid)
    incoming_vat = []
    total_incoming = Decimal("0")

    # Track by VAT rate
    incoming_by_rate = {
        "25": {"vat": Decimal("0"), "accounts": []},
        "12": {"vat": Decimal("0"), "accounts": []},
        "6": {"vat": Decimal("0"), "accounts": []},
    }

    for account in incoming_vat_accounts:
        # Find transactions for this account
        trans = next((t for t in transactions if t.account_id == account.id), None)

        if trans:
            # Incoming VAT is debit (positive), so debit - credit gives positive amount
            vat_amount = (trans.total_debit or Decimal("0")) - (trans.total_credit or Decimal("0"))

            if vat_amount != 0:
                incoming_vat.append(
                    {"account_number": account.account_number, "name": account.name, "amount": float(vat_amount)}
                )
                total_incoming += vat_amount

                # Categorize by VAT rate based on account number
                # 2641: 25%, 2645: 12%, 2647: 6%
                if account.account_number == 2641:
                    incoming_by_rate["25"]["vat"] += vat_amount
                    incoming_by_rate["25"]["accounts"].append(account.account_number)
                elif account.account_number == 2645:
                    incoming_by_rate["12"]["vat"] += vat_amount
                    incoming_by_rate["12"]["accounts"].append(account.account_number)
                elif account.account_number == 2647:
                    incoming_by_rate["6"]["vat"] += vat_amount
                    incoming_by_rate["6"]["accounts"].append(account.account_number)

    # Net VAT = Outgoing - Incoming
    # Positive = Pay to Skatteverket
    # Negative = Refund from Skatteverket
    net_vat = total_outgoing - total_incoming

    # Prepare SKV 3800 form data (Swedish VAT declaration form)
    skv_3800 = {
        "outgoing_25": {
            "vat": float(outgoing_by_rate["25"]["vat"]),
            "sales": float(outgoing_by_rate["25"]["vat"] / Decimal("0.25"))
            if outgoing_by_rate["25"]["vat"] != 0
            else 0.0,
            "box_sales": "05",  # Ruta för försäljning
            "box_vat": "06",  # Ruta för moms
        },
        "outgoing_12": {
            "vat": float(outgoing_by_rate["12"]["vat"]),
            "sales": float(outgoing_by_rate["12"]["vat"] / Decimal("0.12"))
            if outgoing_by_rate["12"]["vat"] != 0
            else 0.0,
            "box_sales": "07",
            "box_vat": "08",
        },
        "outgoing_6": {
            "vat": float(outgoing_by_rate["6"]["vat"]),
            "sales": float(outgoing_by_rate["6"]["vat"] / Decimal("0.06"))
            if outgoing_by_rate["6"]["vat"] != 0
            else 0.0,
            "box_sales": "09",
            "box_vat": "10",
        },
        "incoming_total": {
            "vat": float(total_incoming),
            "box": "30",  # Ruta för ingående moms
        },
        "net_vat": {
            "amount": float(net_vat),
            "box": "48",  # Ruta för moms att betala/få tillbaka
        },
    }

    # Fetch detailed verifications for debug purposes
    verification_details = []
    if transactions:
        # Get all unique verification IDs from our filtered transactions
        verification_ids = (
            db.query(TransactionLine.verification_id)
            .join(Verification, TransactionLine.verification_id == Verification.id)
            .filter(
                Verification.company_id == company_id, TransactionLine.account_id.in_([acc.id for acc in vat_accounts])
            )
        )

        # Apply same filters as main query
        if start_date:
            verification_ids = verification_ids.filter(Verification.transaction_date >= start_date)
        if end_date:
            verification_ids = verification_ids.filter(Verification.transaction_date <= end_date)

        # Apply settlement exclusion
        if exclude_vat_settlements:
            settlement_accounts = (
                db.query(Account.id)
                .filter(Account.company_id == company_id, Account.account_number.in_(SETTLEMENT_ACCOUNTS))
                .all()
            )

            if settlement_accounts:
                settlement_account_ids = [acc.id for acc in settlement_accounts]
                settlement_verification_ids = (
                    db.query(TransactionLine.verification_id)
                    .filter(TransactionLine.account_id.in_(settlement_account_ids))
                    .distinct()
                    .all()
                )
                settlement_ver_ids = [v.verification_id for v in settlement_verification_ids]

                if settlement_ver_ids:
                    verification_ids = verification_ids.filter(~Verification.id.in_(settlement_ver_ids))

        verification_ids = verification_ids.distinct().all()
        ver_ids = [v.verification_id for v in verification_ids]

        # Fetch full verification details
        verifications = (
            db.query(Verification)
            .filter(Verification.id.in_(ver_ids))
            .order_by(Verification.transaction_date.desc())
            .all()
        )

        for ver in verifications:
            # Get ALL transaction lines for this verification (not just VAT)
            all_trans = db.query(TransactionLine).filter(TransactionLine.verification_id == ver.id).all()

            # Get all accounts for these transactions
            all_account_ids = [tl.account_id for tl in all_trans]
            all_accounts = db.query(Account).filter(Account.id.in_(all_account_ids)).all()
            accounts_dict = {acc.id: acc for acc in all_accounts}

            # VAT account IDs for marking
            vat_account_ids = {acc.id for acc in vat_accounts}

            transaction_lines = []
            for tl in all_trans:
                acc = accounts_dict.get(tl.account_id)
                if acc:
                    transaction_lines.append(
                        {
                            "account_number": acc.account_number,
                            "account_name": acc.name,
                            "debit": float(tl.debit),
                            "credit": float(tl.credit),
                            "is_vat_account": tl.account_id in vat_account_ids,
                        }
                    )

            verification_details.append(
                {
                    "id": ver.id,
                    "verification_number": ver.verification_number,
                    "series": ver.series,
                    "transaction_date": ver.transaction_date.isoformat(),
                    "description": ver.description or "",
                    "transaction_lines": transaction_lines,
                }
            )

    return {
        "company_id": company_id,
        "report_type": "vat_report",
        "start_date": start_date.isoformat() if start_date else None,
        "end_date": end_date.isoformat() if end_date else None,
        "outgoing_vat": {"accounts": outgoing_vat, "total": float(total_outgoing)},
        "incoming_vat": {"accounts": incoming_vat, "total": float(total_incoming)},
        "net_vat": float(net_vat),
        "pay_or_refund": "pay" if net_vat > 0 else "refund" if net_vat < 0 else "zero",
        "skv_3800": skv_3800,
        "debug_info": {
            "total_vat_accounts_found": len(vat_accounts),
            "outgoing_vat_accounts": [
                {"number": acc.account_number, "name": acc.name} for acc in outgoing_vat_accounts
            ],
            "incoming_vat_accounts": [
                {"number": acc.account_number, "name": acc.name} for acc in incoming_vat_accounts
            ],
            "transaction_groups_found": len(transactions),
            "accounts_with_transactions": [
                {
                    "number": trans_accounts_by_id[t.account_id].account_number,
                    "name": trans_accounts_by_id[t.account_id].name,
                    "debit": float(t.total_debit or 0),
                    "credit": float(t.total_credit or 0),
                }
                for t in transactions
                if t.account_id in trans_accounts_by_id
            ],
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


@router.get("/vat-debug")
async def get_vat_debug(
    company_id: int = Query(..., description="Company ID"),
    start_date: date | None = Query(None, description="Start date (YYYY-MM-DD)"),
    end_date: date | None = Query(None, description="End date (YYYY-MM-DD)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_active_user),
):
    """
    Debug endpoint to see what VAT accounts and transactions exist
    """
    # Verify user has access to this company
    await verify_company_access(company_id, current_user, db)

    # Get all VAT accounts (including inactive ones)
    vat_accounts = (
        db.query(Account)
        .filter(
            Account.company_id == company_id,
            (
                ((Account.account_number >= 2610) & (Account.account_number <= 2619))
                | ((Account.account_number >= 2640) & (Account.account_number <= 2649))
            ),
        )
        .all()
    )

    # Get all verifications with dates
    query = db.query(Verification).filter(Verification.company_id == company_id)

    if start_date:
        query = query.filter(Verification.transaction_date >= start_date)
    if end_date:
        query = query.filter(Verification.transaction_date <= end_date)

    verifications = query.all()

    # Get transaction lines for VAT accounts
    vat_account_ids = [acc.id for acc in vat_accounts]

    trans_query = (
        db.query(TransactionLine)
        .join(Verification, TransactionLine.verification_id == Verification.id)
        .filter(
            Verification.company_id == company_id,
            TransactionLine.account_id.in_(vat_account_ids) if vat_account_ids else False,
        )
    )

    if start_date:
        trans_query = trans_query.filter(Verification.transaction_date >= start_date)
    if end_date:
        trans_query = trans_query.filter(Verification.transaction_date <= end_date)

    vat_transactions = trans_query.all()

    return {
        "vat_accounts": [
            {
                "id": acc.id,
                "account_number": acc.account_number,
                "name": acc.name,
                "current_balance": float(acc.current_balance),
            }
            for acc in vat_accounts
        ],
        "total_verifications": len(verifications),
        "verification_date_range": {
            "earliest": min([v.transaction_date.isoformat() for v in verifications]) if verifications else None,
            "latest": max([v.transaction_date.isoformat() for v in verifications]) if verifications else None,
        }
        if verifications
        else None,
        "vat_transactions": [
            {
                "account_id": t.account_id,
                "verification_id": t.verification_id,
                "debit": float(t.debit),
                "credit": float(t.credit),
                "verification_date": db.query(Verification)
                .filter(Verification.id == t.verification_id)
                .first()
                .transaction_date.isoformat(),
            }
            for t in vat_transactions[:50]  # Limit to first 50
        ],
        "total_vat_transactions": len(vat_transactions),
        "filters": {
            "start_date": start_date.isoformat() if start_date else None,
            "end_date": end_date.isoformat() if end_date else None,
        },
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
    Export VAT report as XML file for upload to Skatteverket (eSKDUpload format version 6.0)
    Returns an XML file that can be uploaded directly to Swedish Tax Agency.
    """
    # Verify user has access to this company
    await verify_company_access(company_id, current_user, db)

    # Get company info for org number
    company = db.query(Company).filter(Company.id == company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    # Get the VAT report data (reuse existing logic)
    # get_vat_report is an async endpoint function: await it and pass the
    # dependencies explicitly, since FastAPI does not inject them on a direct call.
    vat_report_response = await get_vat_report(
        company_id=company_id,
        start_date=start_date,
        end_date=end_date,
        exclude_vat_settlements=exclude_vat_settlements,
        db=db,
        current_user=current_user,
    )

    skv = vat_report_response["skv_3800"]

    # Format period as YYYYMM (use end date)
    period = end_date.strftime("%Y%m")

    # Convert amounts to integers (öre to whole kronor, rounded)
    def to_int(amount: float) -> int:
        return int(round(amount))

    # Create XML structure
    root = ET.Element("eSKDUpload", Version="6.0")

    # Organization number (format: xxxxxx-xxxx)
    org_nr = ET.SubElement(root, "OrgNr")
    org_nr.text = company.org_number if company.org_number else ""

    # Moms section
    moms = ET.SubElement(root, "Moms")

    # Period
    period_elem = ET.SubElement(moms, "Period")
    period_elem.text = period

    # Sales and output VAT by rate
    # 25% VAT
    if skv["outgoing_25"]["vat"] > 0:
        # Försäljning 25% (Box 05)
        fors_25 = ET.SubElement(moms, "ForsMomsEjAnnan")
        fors_25.text = str(to_int(skv["outgoing_25"]["sales"]))

        # Utgående moms 25% (Box 10 in SKV naming)
        moms_utg_hog = ET.SubElement(moms, "MomsUtgHog")
        moms_utg_hog.text = str(to_int(skv["outgoing_25"]["vat"]))

    # 12% VAT
    if skv["outgoing_12"]["vat"] > 0:
        # Försäljning 12%
        fors_12_elem = ET.SubElement(moms, "ForsMoms12")
        fors_12_elem.text = str(to_int(skv["outgoing_12"]["sales"]))

        # Utgående moms 12%
        moms_utg_medel = ET.SubElement(moms, "MomsUtgMedel")
        moms_utg_medel.text = str(to_int(skv["outgoing_12"]["vat"]))

    # 6% VAT
    if skv["outgoing_6"]["vat"] > 0:
        # Försäljning 6%
        fors_6_elem = ET.SubElement(moms, "ForsMoms6")
        fors_6_elem.text = str(to_int(skv["outgoing_6"]["sales"]))

        # Utgående moms 6%
        moms_utg_lag = ET.SubElement(moms, "MomsUtgLag")
        moms_utg_lag.text = str(to_int(skv["outgoing_6"]["vat"]))

    # Ingående moms (deductible input VAT)
    if skv["incoming_total"]["vat"] > 0:
        moms_ing_avdr = ET.SubElement(moms, "MomsIngAvdr")
        moms_ing_avdr.text = str(to_int(skv["incoming_total"]["vat"]))

    # Net VAT to pay or refund
    moms_betala = ET.SubElement(moms, "MomsBetala")
    net_vat_amount = to_int(skv["net_vat"]["amount"])
    moms_betala.text = str(net_vat_amount)

    # Pretty print the XML with indentation
    def indent(elem, level=0):
        i = "\n" + level * "  "
        if len(elem):
            if not elem.text or not elem.text.strip():
                elem.text = i + "  "
            if not elem.tail or not elem.tail.strip():
                elem.tail = i
            for child in elem:
                indent(child, level + 1)
            if not child.tail or not child.tail.strip():
                child.tail = i
        else:
            if level and (not elem.tail or not elem.tail.strip()):
                elem.tail = i

    indent(root)

    # Build the document explicitly: XML declaration, then DOCTYPE, then the root
    # element. (ET.tostring with encoding="utf-8" emits no declaration, so the old
    # "insert DOCTYPE after the first line" logic put it inside <eSKDUpload>.)
    xml_declaration = '<?xml version="1.0" encoding="utf-8"?>\n'
    doctype = '<!DOCTYPE eSKDUpload PUBLIC "-//Skatteverket, Sweden//DTD Skatteverket eSKDUpload-DTD Version 6.0//SV" "https://www.skatteverket.se/download/18.3f4496fd14864cc5ac99cb1/1415022101213/eSKDUpload_6p0.dtd">\n'
    full_xml = xml_declaration + doctype + ET.tostring(root, encoding="unicode", method="xml").rstrip() + "\n"

    # Return as downloadable file
    filename = f"momsdeklaration_{company.org_number}_{period}.xml"

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
