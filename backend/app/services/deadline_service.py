"""Statutory deadlines computed from the company's settings — nothing is downloaded.

VAT (momsdeklaration): due on the 12th of the second month after the period,
17 August for a period ending in June, the 26th instead of the 12th for monthly
filers above the large-company threshold (not modelled: Reknir companies are
small). A date on a Saturday, Sunday, public holiday, midsommarafton, julafton
or nyårsafton moves to the next working day (Skatteförfarandelagen 2 kap. 4 §).

Annual, for limited companies (org number starting with 5):
- INK2 income tax return: 1 Nov / 15 Dec / 1 Mar / 1 Jul depending on the
  month the fiscal year ends (Jan–Apr / May–Jun / Jul–Aug / Sep–Dec).
- Årsredovisning to Bolagsverket: 7 months after the fiscal year end.
- Årsstämma: within 6 months after the fiscal year end.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

from sqlalchemy.orm import Session

from app.models.company import Company, VATReportingPeriod
from app.models.fiscal_year import FiscalYear
from app.services import ledger_service


@dataclass
class Deadline:
    kind: str  # vat | ink2 | annual_report | annual_meeting
    title: str
    period_start: date | None
    period_end: date | None
    due: date
    status: str  # open | locked | past
    days_left: int

    def as_dict(self) -> dict:
        return {
            "kind": self.kind,
            "title": self.title,
            "period_start": self.period_start.isoformat() if self.period_start else None,
            "period_end": self.period_end.isoformat() if self.period_end else None,
            "due": self.due.isoformat(),
            "status": self.status,
            "days_left": self.days_left,
        }


# ---------------------------------------------------------------------------
# Swedish holidays
# ---------------------------------------------------------------------------


def _easter(year: int) -> date:
    a = year % 19
    b, c = divmod(year, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    length = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * length) // 451
    month, day = divmod(h + length - 7 * m + 114, 31)
    return date(year, month, day + 1)


def swedish_non_working_days(year: int) -> set[date]:
    """Public holidays plus the eves Skatteverket treats as holidays."""
    easter = _easter(year)
    days = {
        date(year, 1, 1),
        date(year, 1, 6),
        easter - timedelta(days=2),  # långfredagen
        easter + timedelta(days=1),  # annandag påsk
        date(year, 5, 1),
        easter + timedelta(days=39),  # Kristi himmelsfärdsdag
        date(year, 6, 6),
        date(year, 12, 24),
        date(year, 12, 25),
        date(year, 12, 26),
        date(year, 12, 31),
    }
    # midsommarafton: Friday between 19 and 25 June; midsommardagen the Saturday after
    d = date(year, 6, 19)
    while d.weekday() != 4:
        d += timedelta(days=1)
    days.update({d, d + timedelta(days=1)})
    # alla helgons dag: Saturday between 31 Oct and 6 Nov
    d = date(year, 10, 31)
    while d.weekday() != 5:
        d += timedelta(days=1)
    days.add(d)
    return days


def next_working_day(d: date) -> date:
    holidays = swedish_non_working_days(d.year) | swedish_non_working_days(d.year + 1)
    while d.weekday() >= 5 or d in holidays:
        d += timedelta(days=1)
    return d


# ---------------------------------------------------------------------------
# VAT
# ---------------------------------------------------------------------------


def _add_months(d: date, months: int) -> date:
    month = d.month - 1 + months
    year = d.year + month // 12
    month = month % 12 + 1
    return date(year, month, 1)


def vat_due_date(period_end: date) -> date:
    """Declaration and payment date for a VAT period ending on ``period_end``."""
    if period_end.month == 6:
        due = date(period_end.year, 8, 17)
    else:
        second_month = _add_months(period_end, 2)
        due = date(second_month.year, second_month.month, 12)
    return next_working_day(due)


def vat_periods(company: Company, year: int) -> list[tuple[str, date, date]]:
    if company.vat_reporting_period == VATReportingPeriod.MONTHLY:
        out = []
        for m in range(1, 13):
            start = date(year, m, 1)
            end = _add_months(start, 1) - timedelta(days=1)
            out.append((f"{year}-{m:02d}", start, end))
        return out
    if company.vat_reporting_period == VATReportingPeriod.QUARTERLY:
        return [
            (f"{year} Q{q}", date(year, 3 * q - 2, 1), _add_months(date(year, 3 * q - 2, 1), 3) - timedelta(days=1))
            for q in range(1, 5)
        ]
    return [(str(year), date(year, 1, 1), date(year, 12, 31))]


# ---------------------------------------------------------------------------
# annual
# ---------------------------------------------------------------------------


def ink2_due_date(fy_end: date) -> date:
    m = fy_end.month
    if m <= 4:
        due = date(fy_end.year, 11, 1)
    elif m <= 6:
        due = date(fy_end.year, 12, 15)
    elif m <= 8:
        due = date(fy_end.year + 1, 3, 1)
    else:
        due = date(fy_end.year + 1, 7, 1)
    return next_working_day(due)


def _is_limited_company(company: Company) -> bool:
    digits = "".join(ch for ch in (company.org_number or "") if ch.isdigit())
    return digits.startswith("5")


# ---------------------------------------------------------------------------
# public
# ---------------------------------------------------------------------------


def upcoming_deadlines(
    db: Session, company: Company, *, today: date | None = None, horizon_days: int = 400, include_past_days: int = 90
) -> list[Deadline]:
    """Deadlines from ``include_past_days`` ago to ``horizon_days`` ahead, soonest first."""
    today = today or date.today()
    locked = ledger_service.locked_through(db, company.id)
    items: list[Deadline] = []

    def status_for(period_end: date | None, due: date) -> str:
        if period_end is not None and locked is not None and period_end <= locked:
            return "locked"
        return "past" if due < today else "open"

    for year in (today.year - 1, today.year, today.year + 1):
        for name, start, end in vat_periods(company, year):
            if company.is_vat_registered is False:
                continue
            due = vat_due_date(end)
            items.append(
                Deadline(
                    kind="vat",
                    title=f"Momsdeklaration {name}",
                    period_start=start,
                    period_end=end,
                    due=due,
                    status=status_for(end, due),
                    days_left=(due - today).days,
                )
            )

    if _is_limited_company(company):
        fiscal_years = db.query(FiscalYear).filter(FiscalYear.company_id == company.id).all()
        for fy in fiscal_years:
            end = fy.end_date
            for kind, title, due in (
                ("ink2", f"Inkomstdeklaration 2 för {fy.label}", ink2_due_date(end)),
                (
                    "annual_report",
                    f"Årsredovisning {fy.label} till Bolagsverket",
                    next_working_day(_add_months(end + timedelta(days=1), 7) - timedelta(days=1)),
                ),
                (
                    "annual_meeting",
                    f"Årsstämma för {fy.label}",
                    next_working_day(_add_months(end + timedelta(days=1), 6) - timedelta(days=1)),
                ),
            ):
                status = "locked" if fy.is_closed else ("past" if due < today else "open")
                items.append(
                    Deadline(
                        kind=kind,
                        title=title,
                        period_start=fy.start_date,
                        period_end=end,
                        due=due,
                        status=status,
                        days_left=(due - today).days,
                    )
                )

    window_start = today - timedelta(days=include_past_days)
    window_end = today + timedelta(days=horizon_days)
    items = [d for d in items if window_start <= d.due <= window_end]
    items.sort(key=lambda d: d.due)
    return items
