"""Pure tests of the momsdeklaration box logic.

The BAS mapping and the rounding rules were verified against the 47 quarterly
Momsredovisning verifications Bokio booked for BotBox AB 2015-2026: all periods
match box by box (three differ by a 300 kr input-VAT item Bokio itself moved
between periods by hand). Those books are private, so this file carries small
synthetic cases that exercise the same rules.
"""

import re
from datetime import date
from decimal import Decimal

from app.services.vat_report_service import (
    BOXES,
    Line,
    box_for_account,
    build_declaration,
    eskd_xml,
    whole_kronor,
)


def L(account, debit="0", credit="0", vid=1, name=""):
    return Line(account, name or str(account), Decimal(debit), Decimal(credit), vid)


class TestMapping:
    def test_output_vat_by_rate(self):
        assert box_for_account(2611) == "10"
        assert box_for_account(2621) == "11"
        assert box_for_account(2631) == "12"

    def test_reverse_charge_and_import_output_vat(self):
        assert box_for_account(2614) == "30"
        assert box_for_account(2617) == "30"
        assert box_for_account(2624) == "31"
        assert box_for_account(2634) == "32"
        assert box_for_account(2615) == "60"
        assert box_for_account(2625) == "61"
        assert box_for_account(2635) == "62"

    def test_input_vat(self):
        for n in (2640, 2641, 2645, 2647, 2649):
            assert box_for_account(n) == "48"

    def test_sales(self):
        assert box_for_account(3001) == "05"
        assert box_for_account(3051) == "05"
        assert box_for_account(3540) == "05"  # faktureringsavgifter
        assert box_for_account(3004) == "42"
        assert box_for_account(3054) == "42"
        assert box_for_account(3106) == "35"
        assert box_for_account(3105) == "36"
        assert box_for_account(3308) == "39"
        assert box_for_account(3305) == "40"
        assert box_for_account(3231) == "41"
        assert box_for_account(3740) is None  # öresutjämning
        assert box_for_account(3900) is None  # övriga rörelseintäkter: unmapped, reported

    def test_reverse_charge_purchases(self):
        assert box_for_account(4515) == "20"
        assert box_for_account(4535) == "21"
        assert box_for_account(4531) == "22"
        assert box_for_account(4415) == "23"
        assert box_for_account(4425) == "24"
        assert box_for_account(4545) == "50"
        assert box_for_account(4598) is None
        assert box_for_account(5410) is None


class TestRounding:
    def test_ore_dropped_toward_zero(self):
        assert whole_kronor(Decimal("1953.30")) == 1953
        assert whole_kronor(Decimal("1953.99")) == 1953
        assert whole_kronor(Decimal("-1953.99")) == -1953
        assert whole_kronor(Decimal("0.60")) == 0

    def test_net_is_sum_of_rounded_boxes(self):
        # Bokio Q4 2025 for BotBox: 30 000 out, 7 906,60 in -> declared 22 094 (not 22 093)
        decl = build_declaration(
            [
                L(3051, credit="120000"),
                L(2611, credit="30000"),
                L(2641, debit="7906.60"),
            ]
        )
        assert decl.whole("10") == 30000
        assert decl.whole("48") == 7906
        assert decl.net_whole == 22094
        assert decl.boxes["49"] == Decimal("22093.40")

    def test_refund_is_negative(self):
        decl = build_declaration([L(2640, debit="1953.30"), L(5410, debit="7813.20")])
        assert decl.net_whole == -1953
        assert decl.whole("48") == 1953


class TestBoxes:
    def test_three_rates(self):
        decl = build_declaration(
            [
                L(3001, credit="1000"),
                L(2611, credit="250"),
                L(3002, credit="1000"),
                L(2621, credit="120"),
                L(3003, credit="1000"),
                L(2631, credit="60"),
            ]
        )
        assert decl.boxes["05"] == Decimal("3000")
        assert decl.boxes["10"] == Decimal("250")
        assert decl.boxes["11"] == Decimal("120")
        assert decl.boxes["12"] == Decimal("60")
        assert decl.net_whole == 430
        assert decl.warnings == []

    def test_reverse_charge_eu_service(self):
        # Service bought from another EU country for 1 336 kr, VAT 334 both ways
        decl = build_declaration(
            [
                L(4535, debit="1336"),
                L(2614, credit="334"),
                L(2645, debit="334"),
            ]
        )
        assert decl.boxes["21"] == Decimal("1336")
        assert decl.boxes["30"] == Decimal("334")
        assert decl.boxes["48"] == Decimal("334")
        assert decl.net_whole == 0
        assert decl.warnings == []

    def test_reverse_charge_without_base_is_flagged(self):
        decl = build_declaration([L(6541, debit="315"), L(2614, credit="78.75"), L(2645, debit="78.75")])
        assert decl.boxes["30"] == Decimal("78.75")
        assert "20" not in decl.boxes
        assert any("ruta 20–24" in w for w in decl.warnings)

    def test_import_without_base_is_flagged(self):
        decl = build_declaration([L(5410, debit="786.84"), L(2615, credit="196.71"), L(2645, debit="196.71")])
        assert decl.whole("60") == 196
        assert any("ruta 50" in w for w in decl.warnings)

    def test_eu_and_export_sales(self):
        decl = build_declaration(
            [L(3106, credit="5000"), L(3105, credit="700"), L(3308, credit="900"), L(3004, credit="100")]
        )
        assert decl.boxes["35"] == Decimal("5000")
        assert decl.boxes["36"] == Decimal("700")
        assert decl.boxes["39"] == Decimal("900")
        assert decl.boxes["42"] == Decimal("100")
        assert "05" not in decl.boxes

    def test_sales_vat_mismatch_is_flagged(self):
        # Accrual reversal over 3051 without VAT shrinks box 05 below what box 10 implies
        decl = build_declaration(
            [
                L(3051, credit="75000"),
                L(2611, credit="18750"),
                L(3051, debit="50000"),  # bortbokning upplupen intäkt
            ]
        )
        assert decl.boxes["05"] == Decimal("25000")
        assert any("Ruta 10" in w and "ruta 05" in w for w in decl.warnings)

    def test_unmapped_accounts_are_reported(self):
        decl = build_declaration([L(3900, credit="1000", name="Övriga rörelseintäkter"), L(4500, debit="200")])
        assert {a for a in decl.unmapped} == {3900, 4500}
        assert any("3900" in w for w in decl.warnings)

    def test_negative_box_is_flagged(self):
        decl = build_declaration([L(3001, debit="1000"), L(2611, debit="250")])
        assert decl.boxes["05"] == Decimal("-1000")
        assert any("negativ" in w for w in decl.warnings)

    def test_to_dict_lists_only_used_boxes_plus_net(self):
        d = build_declaration([L(3001, credit="1000"), L(2611, credit="250")]).to_dict()
        assert d["form"] == "SKV 4700"
        assert [b["box"] for b in d["boxes"]] == ["05", "10", "49"]
        assert d["boxes"][0]["accounts"] == [{"account_number": 3001, "name": "3001", "amount": 1000.0}]
        assert d["net_whole"] == 250


class TestXml:
    def test_elements_in_dtd_order_and_whole_kronor(self):
        decl = build_declaration(
            [
                L(3001, credit="1000.70"),
                L(2611, credit="250.17"),
                L(4535, debit="1336"),
                L(2614, credit="334"),
                L(2645, debit="334"),
                L(2641, debit="99.99"),
            ]
        )
        xml = eskd_xml("556577-9039", date(2026, 9, 30), decl)
        assert xml.startswith('<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE eSKDUpload')
        body = xml[xml.index("<Moms>") + len("<Moms>") :]
        names = re.findall(r"<([A-Za-z0-9]+)>", body)
        assert names == [
            "Period",
            "ForsMomsEjAnnan",
            "InkopTjanstAnnatEg",
            "MomsUtgHog",
            "MomsInkopUtgHog",
            "MomsIngAvdr",
            "MomsBetala",
        ]
        assert "<ForsMomsEjAnnan>1000</ForsMomsEjAnnan>" in xml
        assert "<MomsUtgHog>250</MomsUtgHog>" in xml
        assert "<MomsIngAvdr>433</MomsIngAvdr>" in xml  # 334 + 99.99 -> 433.99 -> 433
        assert "<MomsBetala>151</MomsBetala>" in xml  # 250 + 334 - 433
        assert "<Period>202609</Period>" in xml

    def test_every_box_has_an_element(self):
        assert len({b.element for b in BOXES}) == len(BOXES) == 29
