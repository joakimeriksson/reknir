from datetime import date

from app.models.company import VATReportingPeriod
from app.services import deadline_service as ds


def test_vat_due_dates_follow_skatteverket_rules():
    assert ds.vat_due_date(date(2026, 9, 30)) == date(2026, 11, 12)  # Q3 -> 12 Nov
    assert ds.vat_due_date(date(2026, 6, 30)) == date(2026, 8, 17)  # June period -> 17 Aug
    assert ds.vat_due_date(date(2026, 12, 31)) == date(2027, 2, 12)  # Q4 -> 12 Feb
    assert ds.vat_due_date(date(2026, 3, 31)) == date(2026, 5, 12)
    # 12 Dec 2026 is a Saturday -> Monday 14 Dec
    assert ds.vat_due_date(date(2026, 10, 31)) == date(2026, 12, 14)


def test_holiday_shift():
    # 1 Nov 2025 is a Saturday and alla helgons dag -> Monday 3 Nov
    assert ds.next_working_day(date(2025, 11, 1)) == date(2025, 11, 3)
    # Good Friday 2026 is 3 April -> Tuesday 7 April (Easter Monday 6 April also off)
    assert ds.next_working_day(date(2026, 4, 3)) == date(2026, 4, 7)
    assert ds.next_working_day(date(2026, 6, 19)) == date(2026, 6, 22)  # midsommarafton


def test_ink2_and_annual_report_dates():
    assert ds.ink2_due_date(date(2026, 12, 31)) == date(2027, 7, 1)
    assert ds.ink2_due_date(date(2026, 4, 30)) == date(2026, 11, 2)  # 1 Nov 2026 is a Sunday


def test_upcoming_deadlines_api(client, auth_headers, db_session, test_company_with_fiscal_year):
    company, fy = test_company_with_fiscal_year
    assert company.vat_reporting_period == VATReportingPeriod.QUARTERLY
    items = ds.upcoming_deadlines(db_session, company, today=date(2026, 10, 11))
    titles = [(d.title, d.due.isoformat(), d.status) for d in items]
    assert ("Momsdeklaration 2026 Q3", "2026-11-12", "open") in titles
    assert ("Momsdeklaration 2026 Q2", "2026-08-17", "past") in titles
    assert not any(t.startswith("Årsredovisning") for t, _, _ in titles)  # 123456-7890 is not an AB org number
    company.org_number = "556577-9039"
    db_session.commit()
    # fiscal year 2025 -> annual deadlines fall in 2026; look at them from March 2026
    ab_items = {d.kind: d for d in ds.upcoming_deadlines(db_session, company, today=date(2026, 3, 1))}
    assert ab_items["ink2"].due == date(2026, 7, 1)
    assert ab_items["annual_report"].due == date(2026, 7, 31)
    assert ab_items["annual_meeting"].due == date(2026, 6, 30)
    response = client.get(f"/api/companies/{company.id}/deadlines", headers=auth_headers)
    assert response.status_code == 200
    assert any(d["kind"] == "vat" for d in response.json())


def test_locked_period_marks_deadline_locked(client, auth_headers, db_session, test_company_with_fiscal_year):
    company, fy = test_company_with_fiscal_year
    client.post(
        f"/api/companies/{company.id}/period-locks", json={"locked_through": "2026-09-30"}, headers=auth_headers
    )
    items = {d.title: d.status for d in ds.upcoming_deadlines(db_session, company, today=date(2026, 10, 11))}
    assert items["Momsdeklaration 2026 Q3"] == "locked"
    assert items["Momsdeklaration 2026 Q4"] == "open"
