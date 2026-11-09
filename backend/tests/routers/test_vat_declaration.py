"""Momsrapport API: declaration boxes, 12 %/6 % accounts and the eSKD file with several boxes."""

from datetime import date
from decimal import Decimal

import pytest

from app.models.account import Account, AccountType
from app.models.verification import TransactionLine, Verification


@pytest.fixture
def books(db_session, test_company_with_fiscal_year):
    company, fy = test_company_with_fiscal_year
    company.org_number = "556577-9039"
    acc = {}
    for number, kind in [
        (1510, AccountType.ASSET),
        (1930, AccountType.ASSET),
        (2440, AccountType.EQUITY_LIABILITY),
        (2611, AccountType.EQUITY_LIABILITY),
        (2614, AccountType.EQUITY_LIABILITY),
        (2621, AccountType.EQUITY_LIABILITY),
        (2631, AccountType.EQUITY_LIABILITY),
        (2641, AccountType.EQUITY_LIABILITY),
        (2645, AccountType.EQUITY_LIABILITY),
        (2650, AccountType.EQUITY_LIABILITY),
        (3001, AccountType.REVENUE),
        (3002, AccountType.REVENUE),
        (3003, AccountType.REVENUE),
        (3740, AccountType.REVENUE),
        (4535, AccountType.COST_GOODS),
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

    # Sales at three rates
    ver(
        1,
        date(2025, 7, 5),
        "Faktura 25 %",
        [(acc[1510], "12500", "0"), (acc[3001], "0", "10000"), (acc[2611], "0", "2500")],
    )
    ver(
        2,
        date(2025, 7, 6),
        "Faktura 12 %",
        [(acc[1510], "2240", "0"), (acc[3002], "0", "2000"), (acc[2621], "0", "240")],
    )
    ver(
        3, date(2025, 7, 7), "Faktura 6 %", [(acc[1510], "1060", "0"), (acc[3003], "0", "1000"), (acc[2631], "0", "60")]
    )
    # Domestic purchase
    ver(
        4,
        date(2025, 8, 1),
        "Inköp",
        [(acc[5410], "4000", "0"), (acc[2641], "1000.49", "0"), (acc[1930], "0", "5000.49")],
    )
    # EU service, reverse charge
    ver(
        5,
        date(2025, 8, 15),
        "Molntjänst EU",
        [(acc[4535], "1336", "0"), (acc[2440], "0", "1336"), (acc[2614], "0", "334"), (acc[2645], "334", "0")],
    )
    # Settlement of the previous period, must be ignored
    ver(
        6,
        date(2025, 7, 1),
        "Momsredovisning: april 2025 - juni 2025",
        [(acc[2650], "500", "0"), (acc[2641], "0", "500")],
    )
    return company, fy


def _report(client, headers, company, fy, **params):
    return client.get(
        "/api/reports/vat-report",
        params={
            "company_id": company.id,
            "fiscal_year_id": fy.id,
            "start_date": "2025-07-01",
            "end_date": "2025-09-30",
            "exclude_vat_settlements": True,
            **params,
        },
        headers=headers,
    )


def test_declaration_boxes(client, auth_headers, books):
    company, fy = books
    r = _report(client, auth_headers, company, fy)
    assert r.status_code == 200, r.text
    body = r.json()

    boxes = {b["box"]: b for b in body["declaration"]["boxes"]}
    assert boxes["05"]["whole"] == 13000
    assert boxes["10"]["whole"] == 2500
    assert boxes["11"]["whole"] == 240
    assert boxes["12"]["whole"] == 60
    assert boxes["21"]["whole"] == 1336
    assert boxes["30"]["whole"] == 334
    assert boxes["48"]["whole"] == 1334  # 1000.49 + 334 = 1334.49
    assert boxes["49"]["whole"] == 2500 + 240 + 60 + 334 - 1334
    assert body["declaration"]["net_whole"] == 1800
    assert body["declaration"]["warnings"] == []
    assert body["declaration"]["form"] == "SKV 4700"

    # Ledger view: outgoing includes 2614, incoming includes 2645; settlement excluded
    assert body["outgoing_vat"]["total"] == pytest.approx(2500 + 240 + 60 + 334)
    assert body["incoming_vat"]["total"] == pytest.approx(1334.49)
    assert body["net_vat"] == pytest.approx(1799.51)
    assert body["pay_or_refund"] == "pay"
    assert body["debug_info"]["excluded_settlement_verifications"] == 1
    assert {b["account_number"] for b in boxes["48"]["accounts"]} == {2641, 2645}


def test_settlement_included_when_not_excluded(client, auth_headers, books):
    company, fy = books
    body = _report(client, auth_headers, company, fy, exclude_vat_settlements=False).json()
    assert body["incoming_vat"]["total"] == pytest.approx(1334.49 - 500)


def test_xml_has_all_boxes_in_order(client, auth_headers, books):
    company, fy = books
    r = client.get(
        "/api/reports/vat-report-xml",
        params={
            "company_id": company.id,
            "start_date": "2025-07-01",
            "end_date": "2025-09-30",
            "exclude_vat_settlements": True,
        },
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    xml = r.content.decode()
    expected = """<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE eSKDUpload PUBLIC "-//Skatteverket, Sweden//DTD Skatteverket eSKDUpload-DTD Version 6.0//SV" "https://www.skatteverket.se/download/18.3f4496fd14864cc5ac99cb1/1415022101213/eSKDUpload_6p0.dtd">
<eSKDUpload Version="6.0">
  <OrgNr>556577-9039</OrgNr>
  <Moms>
    <Period>202509</Period>
    <ForsMomsEjAnnan>13000</ForsMomsEjAnnan>
    <InkopTjanstAnnatEg>1336</InkopTjanstAnnatEg>
    <MomsUtgHog>2500</MomsUtgHog>
    <MomsUtgMedel>240</MomsUtgMedel>
    <MomsUtgLag>60</MomsUtgLag>
    <MomsInkopUtgHog>334</MomsInkopUtgHog>
    <MomsIngAvdr>1334</MomsIngAvdr>
    <MomsBetala>1800</MomsBetala>
  </Moms>
</eSKDUpload>
"""
    assert xml == expected
    assert r.headers["content-disposition"].endswith("momsdeklaration_556577-9039_202509.xml")
