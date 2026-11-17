"""
Momsdeklaration (SKV 4700) from the ledger.

Every box on the Swedish VAT return is derived from BAS account numbers, so the
report is only as good as the chart of accounts the company uses. The mapping is
the BAS 2024 standard; anything booked on an account without a rule is listed in
``unmapped_accounts`` so the user can see what was left out.

Rounding follows Skatteverket: each box is reported in whole kronor with the öre
dropped (truncation toward zero), and box 49 is the sum of the rounded VAT boxes,
so the file is internally consistent. This is also exactly how Bokio books its
"Momsredovisning" verifications, which is what the figures were verified against.

Two layers:

* :func:`collect_lines` reads the period's transaction lines from the database,
  excluding VAT settlement verifications when asked.
* :func:`build_declaration` is a pure function over those lines and is what the
  tests and the regression script against Bokio's books exercise.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from sqlalchemy.orm import Session

from app.models.account import Account
from app.models.verification import TransactionLine, Verification

FORM = "SKV 4700"

# Accounts that only appear when VAT is settled against Skatteverket. A verification
# touching one of them (or described as a momsredovisning) is the period's settlement
# and must not be counted as business VAT.
SETTLEMENT_ACCOUNTS = [1630, 1650, 2650, 2660]
SETTLEMENT_WORDS = ("momsredovisning", "momsdeklaration", "momsavräkning")


@dataclass(frozen=True)
class Box:
    number: str
    element: str  # eSKD XML element
    label: str
    kind: str  # "sales", "purchases", "output_vat", "input_vat", "net"
    rate: Decimal | None = None  # VAT rate the box carries, for consistency checks


# Boxes in the order the eSKD 6.0 DTD requires them inside <Moms>.
BOXES: list[Box] = [
    Box("05", "ForsMomsEjAnnan", "Momspliktig försäljning som inte ingår i annan ruta", "sales"),
    Box("06", "UttagMoms", "Momspliktiga uttag", "sales"),
    Box("07", "UlagMargbesk", "Beskattningsunderlag vid vinstmarginalbeskattning", "sales"),
    Box("08", "HyrinkomstFriv", "Hyresinkomster vid frivillig skattskyldighet", "sales"),
    Box("20", "InkopVaruAnnatEg", "Inköp av varor från annat EU-land", "purchases"),
    Box("21", "InkopTjanstAnnatEg", "Inköp av tjänster från annat EU-land", "purchases"),
    Box("22", "InkopTjanstUtomEg", "Inköp av tjänster från land utanför EU", "purchases"),
    Box("23", "InkopVaruSverige", "Inköp av varor i Sverige (omvänd skattskyldighet)", "purchases"),
    Box("24", "InkopTjanstSverige", "Övriga inköp av tjänster (omvänd skattskyldighet)", "purchases"),
    Box("50", "MomsUlagImport", "Beskattningsunderlag vid import", "purchases"),
    Box("35", "ForsVaruAnnatEg", "Försäljning av varor till annat EU-land", "sales"),
    Box("36", "ForsVaruUtomEg", "Försäljning av varor utanför EU", "sales"),
    Box("37", "InkopVaruMellan3p", "Mellanmans inköp av varor vid trepartshandel", "purchases"),
    Box("38", "ForsVaruMellan3p", "Mellanmans försäljning av varor vid trepartshandel", "sales"),
    Box("39", "ForsTjSkskAnnatEg", "Försäljning av tjänster till näringsidkare i annat EU-land", "sales"),
    Box("40", "ForsTjOvrUtomEg", "Övrig försäljning av tjänster omsatta utom landet", "sales"),
    Box("41", "ForsKopareSkskSverige", "Försäljning när köparen är skattskyldig i Sverige", "sales"),
    Box("42", "ForsOvrigt", "Övrig försäljning m.m. (momsfri)", "sales"),
    Box("10", "MomsUtgHog", "Utgående moms 25 %", "output_vat", Decimal("0.25")),
    Box("11", "MomsUtgMedel", "Utgående moms 12 %", "output_vat", Decimal("0.12")),
    Box("12", "MomsUtgLag", "Utgående moms 6 %", "output_vat", Decimal("0.06")),
    Box("30", "MomsInkopUtgHog", "Utgående moms 25 % på inköp (ruta 20–24)", "output_vat", Decimal("0.25")),
    Box("31", "MomsInkopUtgMedel", "Utgående moms 12 % på inköp (ruta 20–24)", "output_vat", Decimal("0.12")),
    Box("32", "MomsInkopUtgLag", "Utgående moms 6 % på inköp (ruta 20–24)", "output_vat", Decimal("0.06")),
    Box("60", "MomsImportUtgHog", "Utgående moms 25 % på import (ruta 50)", "output_vat", Decimal("0.25")),
    Box("61", "MomsImportUtgMedel", "Utgående moms 12 % på import (ruta 50)", "output_vat", Decimal("0.12")),
    Box("62", "MomsImportUtgLag", "Utgående moms 6 % på import (ruta 50)", "output_vat", Decimal("0.06")),
    Box("48", "MomsIngAvdr", "Ingående moms att dra av", "input_vat"),
    Box("49", "MomsBetala", "Moms att betala eller få tillbaka", "net"),
]
BOX_BY_NUMBER = {b.number: b for b in BOXES}

# ---------------------------------------------------------------------------
# BAS 2024 account -> box. Exact numbers win over ranges.
# ---------------------------------------------------------------------------

_EXACT: dict[int, str] = {
    # Output VAT: reverse charge and import sub-accounts
    2614: "30",
    2617: "30",
    2615: "60",
    2624: "31",
    2627: "31",
    2625: "61",
    2634: "32",
    2637: "32",
    2635: "62",
    # Sales outside the ordinary taxable box
    3004: "42",
    3014: "42",
    3044: "42",
    3054: "42",
    3105: "36",
    3106: "35",
    3108: "05",
    3231: "41",
    3305: "40",
    3308: "39",
    # Purchases subject to reverse charge / import
    4415: "23",
    4416: "23",
    4417: "23",
    4425: "24",
    4426: "24",
    4427: "24",
    4515: "20",
    4516: "20",
    4517: "20",
    4531: "22",
    4532: "22",
    4533: "22",
    4535: "21",
    4536: "21",
    4537: "21",
    4545: "50",
    4546: "50",
    4547: "50",
}

# Accounts in the watched classes that deliberately map to no box.
_IGNORED: set[int] = {
    3740,  # Öres- och kronutjämning
    4518,  # Inköp av varor från annat EU-land, momsfri
    4598,  # Justering, omvänd moms (Bokio balancing account)
}

_RANGES: list[tuple[int, int, str]] = [
    (2610, 2619, "10"),
    (2620, 2629, "11"),
    (2630, 2639, "12"),
    (2640, 2649, "48"),
    (3000, 3799, "05"),
]

# Accounts we report as "unmapped" when they carry activity but have no rule:
# the revenue class and the reverse-charge purchase range.
_WATCHED: list[tuple[int, int]] = [(3000, 3999), (4400, 4599)]


def box_for_account(number: int) -> str | None:
    """Return the box an account feeds, or None."""
    if number in _IGNORED:
        return None
    if number in _EXACT:
        return _EXACT[number]
    for lo, hi, box in _RANGES:
        if lo <= number <= hi:
            return box
    return None


def _is_watched(number: int) -> bool:
    return any(lo <= number <= hi for lo, hi in _WATCHED)


def whole_kronor(amount: Decimal) -> int:
    """Skatteverket wants whole kronor with the öre dropped (toward zero)."""
    return int(amount.quantize(Decimal("0.01")).to_integral_value(rounding="ROUND_DOWN"))


# ---------------------------------------------------------------------------
# Data access
# ---------------------------------------------------------------------------


@dataclass
class Line:
    account_number: int
    account_name: str
    debit: Decimal
    credit: Decimal
    verification_id: int


def settlement_verification_ids(db: Session, company_id: int) -> set[int]:
    """Ids of verifications that settle VAT against Skatteverket."""
    ids: set[int] = set()
    acc_ids = [
        a.id
        for a in db.query(Account.id)
        .filter(Account.company_id == company_id, Account.account_number.in_(SETTLEMENT_ACCOUNTS))
        .all()
    ]
    if acc_ids:
        ids.update(
            r.verification_id
            for r in db.query(TransactionLine.verification_id)
            .filter(TransactionLine.account_id.in_(acc_ids))
            .distinct()
            .all()
        )
    q = db.query(Verification.id).filter(Verification.company_id == company_id)
    word_filter = None
    for w in SETTLEMENT_WORDS:
        cond = Verification.description.ilike(f"%{w}%")
        word_filter = cond if word_filter is None else (word_filter | cond)
    ids.update(r.id for r in q.filter(word_filter).all())
    return ids


def collect_lines(
    db: Session,
    company_id: int,
    start_date: date | None,
    end_date: date | None,
    exclude_settlements: bool,
) -> tuple[list[Line], set[int]]:
    """All transaction lines in the period on accounts the declaration looks at."""
    excluded = settlement_verification_ids(db, company_id) if exclude_settlements else set()

    q = (
        db.query(
            Account.account_number,
            Account.name,
            TransactionLine.debit,
            TransactionLine.credit,
            TransactionLine.verification_id,
        )
        .join(TransactionLine, TransactionLine.account_id == Account.id)
        .join(Verification, TransactionLine.verification_id == Verification.id)
        .filter(Verification.company_id == company_id)
        .filter(
            ((Account.account_number >= 2610) & (Account.account_number <= 2649))
            | ((Account.account_number >= 3000) & (Account.account_number <= 3999))
            | ((Account.account_number >= 4400) & (Account.account_number <= 4599))
        )
    )
    if start_date:
        q = q.filter(Verification.transaction_date >= start_date)
    if end_date:
        q = q.filter(Verification.transaction_date <= end_date)
    if excluded:
        q = q.filter(~Verification.id.in_(list(excluded)))

    lines = [Line(int(n), name or "", Decimal(d or 0), Decimal(c or 0), vid) for n, name, d, c, vid in q.all()]
    return lines, excluded


# ---------------------------------------------------------------------------
# Pure computation
# ---------------------------------------------------------------------------


@dataclass
class Declaration:
    boxes: dict[str, Decimal] = field(default_factory=dict)  # exact amounts per box
    accounts_by_box: dict[str, dict[int, tuple[str, Decimal]]] = field(default_factory=dict)
    unmapped: dict[int, tuple[str, Decimal]] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)

    def whole(self, box: str) -> int:
        return whole_kronor(self.boxes.get(box, Decimal(0)))

    @property
    def net_whole(self) -> int:
        """Box 49 from the rounded VAT boxes, as Skatteverket computes it."""
        out = sum(self.whole(b.number) for b in BOXES if b.kind == "output_vat")
        return out - self.whole("48")

    def to_dict(self) -> dict:
        rows = []
        for b in BOXES:
            if b.kind == "net":
                amount = self.boxes.get("49", Decimal(0))
                rows.append(
                    {
                        "box": b.number,
                        "element": b.element,
                        "label": b.label,
                        "kind": b.kind,
                        "amount": float(amount),
                        "whole": self.net_whole,
                        "accounts": [],
                    }
                )
                continue
            amount = self.boxes.get(b.number)
            if amount is None or amount == 0:
                continue
            accounts = [
                {"account_number": n, "name": name, "amount": float(v)}
                for n, (name, v) in sorted(self.accounts_by_box.get(b.number, {}).items())
            ]
            rows.append(
                {
                    "box": b.number,
                    "element": b.element,
                    "label": b.label,
                    "kind": b.kind,
                    "amount": float(amount),
                    "whole": self.whole(b.number),
                    "accounts": accounts,
                }
            )
        return {
            "form": FORM,
            "boxes": rows,
            "net_whole": self.net_whole,
            "warnings": list(self.warnings),
            "unmapped_accounts": [
                {"account_number": n, "name": name, "amount": float(v)}
                for n, (name, v) in sorted(self.unmapped.items())
            ],
        }


def build_declaration(lines: list[Line]) -> Declaration:
    """Fold transaction lines into declaration boxes and run consistency checks."""
    decl = Declaration()
    boxes: dict[str, Decimal] = defaultdict(Decimal)
    per_box_accounts: dict[str, dict[int, tuple[str, Decimal]]] = defaultdict(dict)
    unmapped: dict[int, tuple[str, Decimal]] = {}

    for ln in lines:
        box = box_for_account(ln.account_number)
        if box is None:
            if _is_watched(ln.account_number) and ln.account_number not in _IGNORED:
                prev = unmapped.get(ln.account_number, (ln.account_name, Decimal(0)))[1]
                unmapped[ln.account_number] = (ln.account_name, prev + ln.credit - ln.debit)
            continue
        kind = BOX_BY_NUMBER[box].kind
        # Sales and output VAT are credit balances; purchases and input VAT are debit balances.
        signed = (ln.credit - ln.debit) if kind in ("sales", "output_vat") else (ln.debit - ln.credit)
        boxes[box] += signed
        prev = per_box_accounts[box].get(ln.account_number, (ln.account_name, Decimal(0)))[1]
        per_box_accounts[box][ln.account_number] = (ln.account_name, prev + signed)

    decl.boxes = {k: v for k, v in boxes.items() if v != 0}
    decl.accounts_by_box = {k: {n: t for n, t in v.items() if t[1] != 0} for k, v in per_box_accounts.items()}
    decl.unmapped = {n: t for n, t in unmapped.items() if t[1] != 0}

    output_total = sum((decl.boxes.get(b.number, Decimal(0)) for b in BOXES if b.kind == "output_vat"), Decimal(0))
    decl.boxes["49"] = output_total - decl.boxes.get("48", Decimal(0))

    _check_consistency(decl)
    return decl


def _tolerance(base: Decimal) -> Decimal:
    return max(Decimal(5), abs(base) * Decimal("0.01"))


def _check_consistency(decl: Declaration) -> None:
    b = decl.boxes
    z = Decimal(0)

    for number, amount in b.items():
        if number != "49" and amount < 0:
            decl.warnings.append(
                f"Ruta {number} är negativ ({amount:.2f} kr). Skatteverket tar inte emot negativa belopp i den rutan; "
                "kontrollera kreditfakturor och rättelser i perioden."
            )

    # Domestic sales vs output VAT, when only one rate is in play
    sales = b.get("05", z)
    rates_used = [r for r in ("10", "11", "12") if b.get(r, z) != 0]
    if sales != 0 and len(rates_used) == 1:
        box = BOX_BY_NUMBER[rates_used[0]]
        expected = sales * box.rate
        if abs(expected - b[rates_used[0]]) > _tolerance(expected):
            decl.warnings.append(
                f"Ruta {box.number} ({b[rates_used[0]]:.2f} kr) stämmer inte med {box.rate * 100:.0f} % av "
                f"försäljningen i ruta 05 ({sales:.2f} kr ger {expected:.2f} kr). "
                "Kontrollera att försäljning och moms är bokförda på rätt konton."
            )
    elif sales == 0 and rates_used:
        decl.warnings.append(
            "Utgående moms finns men ingen försäljning i ruta 05. Kontrollera att intäkterna är bokförda på 3xxx-konton."
        )

    # Reverse charge: purchases in 20–24 should carry output VAT in 30–32 (and vice versa)
    rc_base = sum((b.get(n, z) for n in ("20", "21", "22", "23", "24")), z)
    rc_vat = sum((b.get(n, z) for n in ("30", "31", "32")), z)
    if rc_vat != 0 and rc_base == 0:
        decl.warnings.append(
            "Utgående moms på inköp (ruta 30–32) finns utan underlag i ruta 20–24. Boka inköpet på 4515/4535/4531 "
            "eller motsvarande så att underlaget kommer med."
        )
    elif rc_base != 0 and rc_vat == 0:
        decl.warnings.append(
            "Inköp med omvänd skattskyldighet (ruta 20–24) finns utan utgående moms i ruta 30–32. "
            "Kontrollera att momsen är bokförd på 2614/2624/2634."
        )
    elif rc_base != 0 and b.get("31", z) == 0 and b.get("32", z) == 0:
        expected = rc_base * Decimal("0.25")
        if abs(expected - rc_vat) > _tolerance(expected):
            decl.warnings.append(
                f"Ruta 30 ({rc_vat:.2f} kr) stämmer inte med 25 % av inköpen i ruta 20–24 ({rc_base:.2f} kr ger "
                f"{expected:.2f} kr)."
            )

    # Import
    imp_vat = sum((b.get(n, z) for n in ("60", "61", "62")), z)
    if imp_vat != 0 and b.get("50", z) == 0:
        decl.warnings.append(
            "Utgående moms på import (ruta 60–62) finns utan beskattningsunderlag i ruta 50. "
            "Boka importen på 4545–4547 så att underlaget kommer med."
        )

    if decl.unmapped:
        names = ", ".join(f"{n} {t[0]}".strip() for n, t in sorted(decl.unmapped.items()))
        decl.warnings.append(
            f"Konton med rörelser i perioden som inte ingår i någon ruta: {names}. "
            "Är det momspliktig försäljning eller inköp med omvänd skattskyldighet behöver de bokas om."
        )


# ---------------------------------------------------------------------------
# eSKD XML
# ---------------------------------------------------------------------------

DOCTYPE = (
    '<!DOCTYPE eSKDUpload PUBLIC "-//Skatteverket, Sweden//DTD Skatteverket eSKDUpload-DTD Version 6.0//SV" '
    '"https://www.skatteverket.se/download/18.3f4496fd14864cc5ac99cb1/1415022101213/eSKDUpload_6p0.dtd">'
)


def eskd_xml(org_number: str, period_end: date, decl: Declaration) -> str:
    """Render the declaration as an eSKDUpload 6.0 document, elements in DTD order."""
    out = [
        '<?xml version="1.0" encoding="utf-8"?>',
        DOCTYPE,
        '<eSKDUpload Version="6.0">',
        f"  <OrgNr>{org_number}</OrgNr>",
        "  <Moms>",
        f"    <Period>{period_end:%Y%m}</Period>",
    ]
    for b in BOXES:
        if b.kind == "net":
            out.append(f"    <{b.element}>{decl.net_whole}</{b.element}>")
            continue
        value = decl.whole(b.number)
        if value != 0:
            out.append(f"    <{b.element}>{value}</{b.element}>")
    out += ["  </Moms>", "</eSKDUpload>", ""]
    return "\n".join(out)
