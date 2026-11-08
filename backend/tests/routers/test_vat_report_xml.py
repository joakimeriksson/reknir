"""The eSKD XML export must produce the same file as Bokio for the same bookkeeping.

Expected output is taken verbatim from the file Bokio generated for BotBox AB's
Q3 2026 VAT return (one purchase with 1 953,30 kr input VAT, settled with
1650/2640/3740), with the period moved into the test fiscal year.
"""

from datetime import date
from decimal import Decimal

import pytest

from app.models.account import Account, AccountType
from app.models.verification import TransactionLine, Verification

BOKIO_FILE = """<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE eSKDUpload PUBLIC "-//Skatteverket, Sweden//DTD Skatteverket eSKDUpload-DTD Version 6.0//SV" "https://www.skatteverket.se/download/18.3f4496fd14864cc5ac99cb1/1415022101213/eSKDUpload_6p0.dtd">
<eSKDUpload Version="6.0">
  <OrgNr>556577-9039</OrgNr>
  <Moms>
    <Period>202509</Period>
    <MomsIngAvdr>1953</MomsIngAvdr>
    <MomsBetala>-1953</MomsBetala>
  </Moms>
</eSKDUpload>"""


@pytest.fixture
def q3_books(db_session, test_company_with_fiscal_year):
    company, fy = test_company_with_fiscal_year
    company.org_number = "556577-9039"
    acc = {}
    for number, kind in [
        (1650, AccountType.ASSET),
        (2640, AccountType.EQUITY_LIABILITY),
        (2890, AccountType.EQUITY_LIABILITY),
        (3740, AccountType.REVENUE),
        (5410, AccountType.COST_LOCAL),
    ]:
        a = Account(
            company_id=company.id, fiscal_year_id=fy.id, account_number=number, name=str(number), account_type=kind
        )
        db_session.add(a)
        acc[number] = a
    db_session.commit()

    def ver(number, when, text, lines):
        v = Verification(
            company_id=company.id,
            fiscal_year_id=fy.id,
            verification_number=number,
            series="V",
            transaction_date=when,
            description=text,
        )
        db_session.add(v)
        db_session.flush()
        for a, debit, credit in lines:
            db_session.add(
                TransactionLine(verification_id=v.id, account_id=a.id, debit=Decimal(debit), credit=Decimal(credit))
            )
        db_session.commit()

    ver(
        15,
        date(2025, 9, 28),
        "Utlägg Niclas Finne - GEEKOM IT13 HTPC (Conrad 9790312661)",
        [(acc[2640], "1953.30", "0"), (acc[5410], "7813.20", "0"), (acc[2890], "0", "9766.50")],
    )
    ver(
        16,
        date(2025, 9, 30),
        "Momsredovisning: juli 2025 - september 2025",
        [(acc[1650], "1953.00", "0"), (acc[3740], "0.30", "0"), (acc[2640], "0", "1953.30")],
    )
    return company, fy


def _get_xml(client, headers, company, fy, **extra):
    return client.get(
        "/api/reports/vat-report-xml",
        params={
            "company_id": company.id,
            "fiscal_year_id": fy.id,
            "start_date": "2025-07-01",
            "end_date": "2025-09-30",
            "exclude_vat_settlements": True,
            **extra,
        },
        headers=headers,
    )


def test_vat_xml_matches_bokio(client, auth_headers, q3_books):
    company, fy = q3_books
    response = _get_xml(client, auth_headers, company, fy)

    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("application/xml")
    assert "attachment" in response.headers["content-disposition"]
    assert response.content.decode("utf-8").strip() == BOKIO_FILE


def test_vat_xml_requires_auth(client, q3_books):
    company, fy = q3_books
    assert _get_xml(client, {}, company, fy).status_code == 401


def test_vat_xml_denies_other_company(client, admin_auth_headers, auth_headers, db_session, q3_books):
    from app.models.company import Company

    other = Company(
        name="Other AB",
        org_number="559999-0000",
        fiscal_year_start=date(2025, 1, 1),
        fiscal_year_end=date(2025, 12, 31),
    )
    db_session.add(other)
    db_session.commit()
    _, fy = q3_books
    assert _get_xml(client, auth_headers, other, fy).status_code == 403
