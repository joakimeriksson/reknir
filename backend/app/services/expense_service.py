from datetime import date
from decimal import Decimal

from sqlalchemy.orm import Session

from app.models.account import Account
from app.models.expense import Expense
from app.models.verification import TransactionLine, Verification
from app.services.invoice_service import get_fiscal_year_for_date


def create_expense_verification(
    db: Session, expense: Expense, employee_payable_account_id: int, description: str | None = None
) -> Verification:
    """
    Create automatic verification when expense is approved/booked

    Swedish: Bokför utlägg

    Debit:  Cost account (e.g., 6540 Resor)
    Debit:  VAT incoming account (e.g., 2641)
    Credit: 2890 Upplupna kostnader eller annan skuldkonto (Employee payable)
    """

    # Get fiscal year for this expense date
    fiscal_year = get_fiscal_year_for_date(db, expense.company_id, expense.expense_date)

    # Get next verification number
    from app.routers.verifications import get_next_verification_number

    ver_number = get_next_verification_number(db, expense.company_id, "A")

    # Create verification
    verification = Verification(
        company_id=expense.company_id,
        fiscal_year_id=fiscal_year.id,
        verification_number=ver_number,
        series="A",
        transaction_date=expense.expense_date,
        description=description or f"Utlägg - {expense.employee_name}: {expense.description}",
        registration_date=date.today(),
    )
    db.add(verification)
    db.flush()

    # Debit: Expense account
    if not expense.expense_account_id:
        raise ValueError("Expense account must be set to create verification")

    expense_account = db.query(Account).filter(Account.id == expense.expense_account_id).first()
    if not expense_account:
        raise ValueError(f"Expense account {expense.expense_account_id} not found")

    net_amount = expense.amount - expense.vat_amount

    debit_expense_line = TransactionLine(
        verification_id=verification.id,
        account_id=expense_account.id,
        debit=net_amount,
        credit=Decimal("0"),
        description=expense.description,
    )
    db.add(debit_expense_line)
    expense_account.current_balance += net_amount

    # Debit: VAT incoming account (if VAT exists)
    if expense.vat_amount > 0:
        if not expense.vat_account_id:
            raise ValueError("VAT account must be set when expense has VAT")

        vat_account = db.query(Account).filter(Account.id == expense.vat_account_id).first()
        if not vat_account:
            raise ValueError(f"VAT account {expense.vat_account_id} not found")

        debit_vat_line = TransactionLine(
            verification_id=verification.id,
            account_id=vat_account.id,
            debit=expense.vat_amount,
            credit=Decimal("0"),
            description=f"Moms {expense.description}",
        )
        db.add(debit_vat_line)
        vat_account.current_balance += expense.vat_amount

    # Credit: Employee payable account (liability)
    payable_account = db.query(Account).filter(Account.id == employee_payable_account_id).first()
    if not payable_account:
        raise ValueError(f"Employee payable account {employee_payable_account_id} not found")

    credit_line = TransactionLine(
        verification_id=verification.id,
        account_id=payable_account.id,
        debit=Decimal("0"),
        credit=expense.amount,
        description=f"Skuld till {expense.employee_name}",
    )
    db.add(credit_line)
    payable_account.current_balance -= expense.amount

    db.commit()
    db.refresh(verification)

    return verification


def create_expense_payment_verification(
    db: Session, expense: Expense, paid_date: date, bank_account_id: int, description: str | None = None
) -> Verification:
    """
    Create payment verification when expense is paid

    Swedish: Bokför betalning av utlägg

    Debit:  Employee payable account (e.g., 2890 Upplupna kostnader)
    Credit: Bank account (e.g., 1930 Företagskonto)
    """

    # Get fiscal year for the payment date
    fiscal_year = get_fiscal_year_for_date(db, expense.company_id, paid_date)

    # Get next verification number
    from app.routers.verifications import get_next_verification_number

    ver_number = get_next_verification_number(db, expense.company_id, "A")

    # Create verification
    verification = Verification(
        company_id=expense.company_id,
        fiscal_year_id=fiscal_year.id,
        verification_number=ver_number,
        series="A",
        transaction_date=paid_date,
        description=description or f"Betalning utlägg - {expense.employee_name}: {expense.description}",
        registration_date=date.today(),
    )
    db.add(verification)
    db.flush()

    # Get the employee payable account from the original expense verification
    if not expense.verification_id:
        raise ValueError("Expense must be booked before marking as paid")

    # Find the employee payable account from the original verification
    original_verification = db.query(Verification).filter(Verification.id == expense.verification_id).first()
    if not original_verification:
        raise ValueError(f"Original verification {expense.verification_id} not found")

    # Find the credit line in the original verification (employee payable account)
    employee_payable_line = None
    for line in original_verification.transaction_lines:
        if line.credit > 0:  # This should be the employee payable account
            employee_payable_line = line
            break

    if not employee_payable_line:
        raise ValueError("Could not find employee payable account in original verification")

    employee_payable_account_id = employee_payable_line.account_id

    # Debit: Employee payable account (reduces liability)
    payable_account = db.query(Account).filter(Account.id == employee_payable_account_id).first()
    if not payable_account:
        raise ValueError(f"Employee payable account {employee_payable_account_id} not found")

    debit_line = TransactionLine(
        verification_id=verification.id,
        account_id=payable_account.id,
        debit=expense.amount,
        credit=Decimal("0"),
        description=f"Betald till {expense.employee_name}",
    )
    db.add(debit_line)
    payable_account.current_balance += expense.amount  # Reduce liability

    # Credit: Bank account (reduces asset)
    bank_account = db.query(Account).filter(Account.id == bank_account_id).first()
    if not bank_account:
        raise ValueError(f"Bank account {bank_account_id} not found")

    credit_line = TransactionLine(
        verification_id=verification.id,
        account_id=bank_account.id,
        debit=Decimal("0"),
        credit=expense.amount,
        description=f"Betalning till {expense.employee_name}",
    )
    db.add(credit_line)
    bank_account.current_balance -= expense.amount

    db.commit()
    db.refresh(verification)

    return verification
