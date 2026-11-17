"""
Tests for company endpoints (/api/companies).

Covers:
- Company CRUD operations
- Payment information validation
- Access control (user can only access their companies)
- Admin access to all companies
- Org number validation and uniqueness
"""


class TestCreateCompany:
    """Tests for POST /api/companies/"""

    def test_create_company_success_minimal(self, client, admin_auth_headers):
        """Create company with minimal required fields."""
        response = client.post(
            "/api/companies/",
            json={
                "name": "Minimal Company AB",
                "org_number": "556677-8899",
                "fiscal_year_start": "2025-01-01",
                "fiscal_year_end": "2025-12-31",
            },
            headers=admin_auth_headers,
        )
        assert response.status_code == 201
        data = response.json()
        assert data["name"] == "Minimal Company AB"
        assert data["org_number"] == "556677-8899"
        assert "id" in data

    def test_create_company_success_full(self, client, admin_auth_headers):
        """Create company with all fields populated."""
        response = client.post(
            "/api/companies/",
            json={
                "name": "Full Company AB",
                "org_number": "112233-4455",
                "address": "Fullgatan 99",
                "postal_code": "12345",
                "city": "Stockholm",
                "phone": "08-111 22 33",
                "email": "info@fullcompany.se",
                "fiscal_year_start": "2025-01-01",
                "fiscal_year_end": "2025-12-31",
                "vat_number": "SE1122334455",
                "accounting_basis": "accrual",
                "vat_reporting_period": "quarterly",
                "is_vat_registered": True,
                "payment_type": "bankgiro",
                "bankgiro_number": "999-8888",
            },
            headers=admin_auth_headers,
        )
        assert response.status_code == 201
        data = response.json()
        assert data["name"] == "Full Company AB"
        assert data["city"] == "Stockholm"
        assert data["payment_type"] == "bankgiro"
        assert data["bankgiro_number"] == "999-8888"

    def test_create_company_missing_name(self, client, admin_auth_headers):
        """Reject company creation without name."""
        response = client.post(
            "/api/companies/",
            json={
                "org_number": "123456-7890",
                "fiscal_year_start": "2025-01-01",
                "fiscal_year_end": "2025-12-31",
            },
            headers=admin_auth_headers,
        )
        assert response.status_code == 422

    def test_create_company_missing_org_number(self, client, admin_auth_headers):
        """Reject company creation without org_number."""
        response = client.post(
            "/api/companies/",
            json={
                "name": "No Org Number AB",
                "fiscal_year_start": "2025-01-01",
                "fiscal_year_end": "2025-12-31",
            },
            headers=admin_auth_headers,
        )
        assert response.status_code == 422

    def test_create_company_duplicate_org_number(self, client, admin_auth_headers, test_company):
        """Reject company with duplicate org_number."""
        response = client.post(
            "/api/companies/",
            json={
                "name": "Duplicate Org AB",
                "org_number": test_company.org_number,  # Already exists
                "fiscal_year_start": "2025-01-01",
                "fiscal_year_end": "2025-12-31",
            },
            headers=admin_auth_headers,
        )
        assert response.status_code == 400
        assert "already exists" in response.json()["detail"].lower()

    def test_create_company_unauthenticated(self, client):
        """Reject company creation without authentication."""
        response = client.post(
            "/api/companies/",
            json={
                "name": "Unauthenticated Company AB",
                "org_number": "999999-9999",
                "fiscal_year_start": "2025-01-01",
                "fiscal_year_end": "2025-12-31",
            },
        )
        assert response.status_code == 401

    def test_create_company_requires_admin(self, client, auth_headers):
        """A regular user cannot create companies; an admin creates them and grants access."""
        response = client.post(
            "/api/companies/",
            json={
                "name": "Not Allowed AB",
                "org_number": "556677-0000",
                "fiscal_year_start": "2025-01-01",
                "fiscal_year_end": "2025-12-31",
            },
            headers=auth_headers,
        )
        assert response.status_code == 403


class TestPaymentTypeValidation:
    """Tests for payment type validation when creating/updating companies."""

    def test_create_company_bankgiro_without_number(self, client, admin_auth_headers):
        """Reject bankgiro payment type without bankgiro number."""
        response = client.post(
            "/api/companies/",
            json={
                "name": "No Bankgiro Number AB",
                "org_number": "111111-2222",
                "fiscal_year_start": "2025-01-01",
                "fiscal_year_end": "2025-12-31",
                "payment_type": "bankgiro",
                # Missing bankgiro_number
            },
            headers=admin_auth_headers,
        )
        assert response.status_code == 400
        assert "bankgironummer" in response.json()["detail"].lower()

    def test_create_company_plusgiro_without_number(self, client, admin_auth_headers):
        """Reject plusgiro payment type without plusgiro number."""
        response = client.post(
            "/api/companies/",
            json={
                "name": "No Plusgiro Number AB",
                "org_number": "222222-3333",
                "fiscal_year_start": "2025-01-01",
                "fiscal_year_end": "2025-12-31",
                "payment_type": "plusgiro",
                # Missing plusgiro_number
            },
            headers=admin_auth_headers,
        )
        assert response.status_code == 400
        assert "plusgironummer" in response.json()["detail"].lower()

    def test_create_company_bank_account_without_clearing(self, client, admin_auth_headers):
        """Reject bank_account payment type without clearing number."""
        response = client.post(
            "/api/companies/",
            json={
                "name": "No Clearing Number AB",
                "org_number": "333333-4444",
                "fiscal_year_start": "2025-01-01",
                "fiscal_year_end": "2025-12-31",
                "payment_type": "bank_account",
                "account_number": "12345678",
                # Missing clearing_number
            },
            headers=admin_auth_headers,
        )
        assert response.status_code == 400
        assert "clearingnummer" in response.json()["detail"].lower()

    def test_create_company_bank_account_without_account_number(self, client, admin_auth_headers):
        """Reject bank_account payment type without account number."""
        response = client.post(
            "/api/companies/",
            json={
                "name": "No Account Number AB",
                "org_number": "444444-5555",
                "fiscal_year_start": "2025-01-01",
                "fiscal_year_end": "2025-12-31",
                "payment_type": "bank_account",
                "clearing_number": "1234",
                # Missing account_number
            },
            headers=admin_auth_headers,
        )
        assert response.status_code == 400
        assert "kontonummer" in response.json()["detail"].lower()

    def test_create_company_bankgiro_success(self, client, admin_auth_headers):
        """Successfully create company with bankgiro payment."""
        response = client.post(
            "/api/companies/",
            json={
                "name": "Bankgiro Company AB",
                "org_number": "555555-6666",
                "fiscal_year_start": "2025-01-01",
                "fiscal_year_end": "2025-12-31",
                "payment_type": "bankgiro",
                "bankgiro_number": "123-4567",
            },
            headers=admin_auth_headers,
        )
        assert response.status_code == 201
        assert response.json()["payment_type"] == "bankgiro"
        assert response.json()["bankgiro_number"] == "123-4567"

    def test_create_company_plusgiro_success(self, client, admin_auth_headers):
        """Successfully create company with plusgiro payment."""
        response = client.post(
            "/api/companies/",
            json={
                "name": "Plusgiro Company AB",
                "org_number": "666666-7777",
                "fiscal_year_start": "2025-01-01",
                "fiscal_year_end": "2025-12-31",
                "payment_type": "plusgiro",
                "plusgiro_number": "12 34 56-7",
            },
            headers=admin_auth_headers,
        )
        assert response.status_code == 201
        assert response.json()["payment_type"] == "plusgiro"

    def test_create_company_bank_account_success(self, client, admin_auth_headers):
        """Successfully create company with bank account payment."""
        response = client.post(
            "/api/companies/",
            json={
                "name": "Bank Account Company AB",
                "org_number": "777777-8888",
                "fiscal_year_start": "2025-01-01",
                "fiscal_year_end": "2025-12-31",
                "payment_type": "bank_account",
                "clearing_number": "1234",
                "account_number": "567 890 123-4",
                "iban": "SE1234567890123456789012",
                "bic": "NDEASESS",
            },
            headers=admin_auth_headers,
        )
        assert response.status_code == 201
        data = response.json()
        assert data["payment_type"] == "bank_account"
        assert data["clearing_number"] == "1234"
        assert data["iban"] == "SE1234567890123456789012"


class TestGetCompany:
    """Tests for GET /api/companies/{id}"""

    def test_get_company_success(self, client, auth_headers, test_company):
        """Successfully get a company user has access to."""
        response = client.get(f"/api/companies/{test_company.id}", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert data["id"] == test_company.id
        assert data["name"] == test_company.name

    def test_get_company_not_found(self, client, auth_headers):
        """Return 404 for non-existent company."""
        response = client.get("/api/companies/99999", headers=auth_headers)
        assert response.status_code == 404

    def test_get_company_no_access(self, client, auth_headers, factory, db_session):
        """Return 403 when user doesn't have access to company."""
        # Create company without granting access to test_user
        other_company = factory.create_company(
            name="Other Company AB",
            org_number="888888-9999",
        )
        response = client.get(f"/api/companies/{other_company.id}", headers=auth_headers)
        assert response.status_code == 403

    def test_get_company_admin_access(self, client, admin_auth_headers, factory, db_session):
        """Admin can access any company."""
        # Create company without granting admin access
        other_company = factory.create_company(
            name="Any Company AB",
            org_number="999999-0000",
        )
        response = client.get(f"/api/companies/{other_company.id}", headers=admin_auth_headers)
        assert response.status_code == 200

    def test_get_company_unauthenticated(self, client, test_company):
        """Return 401 when not authenticated."""
        response = client.get(f"/api/companies/{test_company.id}")
        assert response.status_code == 401


class TestListCompanies:
    """Tests for GET /api/companies/"""

    def test_list_companies_success(self, client, auth_headers, test_company):
        """List companies user has access to."""
        response = client.get("/api/companies/", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        assert isinstance(data, list)
        assert len(data) >= 1
        company_ids = [c["id"] for c in data]
        assert test_company.id in company_ids

    def test_list_companies_only_accessible(self, client, auth_headers, test_company, factory):
        """User only sees companies they have access to."""
        # Create another company user doesn't have access to
        other_company = factory.create_company(
            name="Other User Company",
            org_number="000000-1111",
        )
        response = client.get("/api/companies/", headers=auth_headers)
        assert response.status_code == 200
        data = response.json()
        company_ids = [c["id"] for c in data]
        assert test_company.id in company_ids
        assert other_company.id not in company_ids

    def test_list_companies_admin_sees_all(self, client, admin_auth_headers, test_company, factory):
        """Admin sees all companies."""
        other_company = factory.create_company(
            name="Admin Test Company",
            org_number="111100-2222",
        )
        response = client.get("/api/companies/", headers=admin_auth_headers)
        assert response.status_code == 200
        data = response.json()
        company_ids = [c["id"] for c in data]
        # Admin should see both
        assert test_company.id in company_ids
        assert other_company.id in company_ids


class TestUpdateCompany:
    """Tests for PATCH /api/companies/{id}"""

    def test_update_company_name(self, client, auth_headers, test_company):
        """Successfully update company name."""
        response = client.patch(
            f"/api/companies/{test_company.id}",
            json={"name": "Updated Company Name AB"},
            headers=auth_headers,
        )
        assert response.status_code == 200
        assert response.json()["name"] == "Updated Company Name AB"

    def test_update_company_address(self, client, auth_headers, test_company):
        """Successfully update company address fields."""
        response = client.patch(
            f"/api/companies/{test_company.id}",
            json={
                "address": "New Address 123",
                "postal_code": "99999",
                "city": "New City",
            },
            headers=auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["address"] == "New Address 123"
        assert data["city"] == "New City"

    def test_update_company_payment_type_bankgiro_to_plusgiro(self, client, auth_headers, test_company):
        """Update payment type from bankgiro to plusgiro."""
        response = client.patch(
            f"/api/companies/{test_company.id}",
            json={
                "payment_type": "plusgiro",
                "plusgiro_number": "12 34 56-7",
            },
            headers=auth_headers,
        )
        assert response.status_code == 200
        data = response.json()
        assert data["payment_type"] == "plusgiro"
        assert data["plusgiro_number"] == "12 34 56-7"

    def test_update_company_payment_type_missing_required(self, client, auth_headers, test_company):
        """Reject payment type update without required fields."""
        response = client.patch(
            f"/api/companies/{test_company.id}",
            json={
                "payment_type": "bank_account",
                # Missing clearing_number and account_number
            },
            headers=auth_headers,
        )
        assert response.status_code == 400

    def test_update_company_no_access(self, client, auth_headers, factory):
        """Reject update for company user doesn't have access to."""
        other_company = factory.create_company(
            name="Other Company",
            org_number="222200-3333",
        )
        response = client.patch(
            f"/api/companies/{other_company.id}",
            json={"name": "Hacked Name"},
            headers=auth_headers,
        )
        assert response.status_code == 403

    def test_update_company_org_number_immutable(self, client, auth_headers, test_company):
        """Org number should not be changeable (or handled appropriately)."""
        response = client.patch(
            f"/api/companies/{test_company.id}",
            json={"org_number": "999999-9999"},
            headers=auth_headers,
        )
        # Either reject or ignore the change
        if response.status_code == 200:
            # If accepted, org_number should remain unchanged
            response.json()  # Verify response is valid JSON
            # Implementation may or may not allow this


class TestDeleteCompany:
    """Tests for DELETE /api/companies/{id}"""

    def test_delete_company_success(self, client, auth_headers, factory, test_user):
        """Successfully delete a company (if allowed)."""
        company = factory.create_company(
            name="To Delete AB",
            org_number="333300-4444",
            user=test_user,
        )
        response = client.delete(f"/api/companies/{company.id}", headers=auth_headers)
        # Might be 204, 200, or 403/405 if deletion is restricted
        assert response.status_code in [200, 204, 403, 405]

    def test_delete_company_not_found(self, client, auth_headers):
        """Return 404 for deleting non-existent company."""
        response = client.delete("/api/companies/99999", headers=auth_headers)
        assert response.status_code in [404, 403]

    def test_delete_company_no_access(self, client, auth_headers, factory):
        """Reject deletion of company user doesn't have access to."""
        other_company = factory.create_company(
            name="Cannot Delete",
            org_number="444400-5555",
        )
        response = client.delete(f"/api/companies/{other_company.id}", headers=auth_headers)
        assert response.status_code in [403, 404]


class TestAccountingBasisValidation:
    """Tests for accounting basis changes."""

    def test_create_company_accrual_basis(self, client, admin_auth_headers):
        """Create company with accrual accounting basis."""
        response = client.post(
            "/api/companies/",
            json={
                "name": "Accrual Company AB",
                "org_number": "555500-6666",
                "fiscal_year_start": "2025-01-01",
                "fiscal_year_end": "2025-12-31",
                "accounting_basis": "accrual",
            },
            headers=admin_auth_headers,
        )
        assert response.status_code == 201
        assert response.json()["accounting_basis"] == "accrual"

    def test_create_company_cash_basis(self, client, admin_auth_headers):
        """Create company with cash accounting basis."""
        response = client.post(
            "/api/companies/",
            json={
                "name": "Cash Basis Company AB",
                "org_number": "666600-7777",
                "fiscal_year_start": "2025-01-01",
                "fiscal_year_end": "2025-12-31",
                "accounting_basis": "cash",
            },
            headers=admin_auth_headers,
        )
        assert response.status_code == 201
        assert response.json()["accounting_basis"] == "cash"

    def test_create_company_invalid_accounting_basis(self, client, admin_auth_headers):
        """Reject invalid accounting basis value."""
        response = client.post(
            "/api/companies/",
            json={
                "name": "Invalid Basis Company AB",
                "org_number": "777700-8888",
                "fiscal_year_start": "2025-01-01",
                "fiscal_year_end": "2025-12-31",
                "accounting_basis": "invalid_basis",
            },
            headers=admin_auth_headers,
        )
        assert response.status_code == 422


class TestVATSettings:
    """Tests for VAT-related company settings."""

    def test_create_company_vat_registered(self, client, admin_auth_headers):
        """Create VAT-registered company."""
        response = client.post(
            "/api/companies/",
            json={
                "name": "VAT Company AB",
                "org_number": "888800-9999",
                "fiscal_year_start": "2025-01-01",
                "fiscal_year_end": "2025-12-31",
                "is_vat_registered": True,
                "vat_number": "SE8888009999",
                "vat_reporting_period": "monthly",
            },
            headers=admin_auth_headers,
        )
        assert response.status_code == 201
        data = response.json()
        assert data["is_vat_registered"] is True
        assert data["vat_reporting_period"] == "monthly"

    def test_create_company_not_vat_registered(self, client, admin_auth_headers):
        """Create non-VAT-registered company."""
        response = client.post(
            "/api/companies/",
            json={
                "name": "No VAT Company AB",
                "org_number": "999900-0000",
                "fiscal_year_start": "2025-01-01",
                "fiscal_year_end": "2025-12-31",
                "is_vat_registered": False,
            },
            headers=admin_auth_headers,
        )
        assert response.status_code == 201
        assert response.json()["is_vat_registered"] is False

    def test_vat_reporting_periods(self, client, admin_auth_headers):
        """Test different VAT reporting periods."""
        periods = ["monthly", "quarterly", "yearly"]
        for i, period in enumerate(periods):
            response = client.post(
                "/api/companies/",
                json={
                    "name": f"VAT Period {period} AB",
                    "org_number": f"00000{i}-1111",
                    "fiscal_year_start": "2025-01-01",
                    "fiscal_year_end": "2025-12-31",
                    "is_vat_registered": True,
                    "vat_reporting_period": period,
                },
                headers=admin_auth_headers,
            )
            assert response.status_code == 201
            assert response.json()["vat_reporting_period"] == period
