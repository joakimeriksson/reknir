"""HTTP client that calls our own REST API with the user's JWT token."""

import httpx


class AIAPIClient:
    """Calls backend REST API endpoints on behalf of the AI assistant."""

    def __init__(self, base_url: str, token: str):
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.headers = {"Authorization": f"Bearer {token}"}

    async def _get(self, path: str, params: dict | None = None) -> dict | list:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(f"{self.base_url}{path}", params=params, headers=self.headers)
            resp.raise_for_status()
            return resp.json()

    async def _post(self, path: str, json_data: dict | None = None, params: dict | None = None) -> dict:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(f"{self.base_url}{path}", json=json_data, params=params, headers=self.headers)
            resp.raise_for_status()
            return resp.json()

    async def _patch(self, path: str, json_data: dict) -> dict:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.patch(f"{self.base_url}{path}", json=json_data, headers=self.headers)
            resp.raise_for_status()
            return resp.json()

    # --- Read operations ---

    async def get_company(self, company_id: int) -> dict:
        return await self._get(f"/api/companies/{company_id}")

    async def list_fiscal_years(self, company_id: int) -> list:
        return await self._get("/api/fiscal-years/", params={"company_id": company_id})

    async def list_accounts(self, company_id: int, fiscal_year_id: int, account_type: str | None = None) -> list:
        params = {"company_id": company_id, "fiscal_year_id": fiscal_year_id}
        if account_type:
            params["account_type"] = account_type
        return await self._get("/api/accounts/", params=params)

    async def get_account_ledger(self, account_id: int, fiscal_year_id: int | None = None) -> dict:
        params = {}
        if fiscal_year_id:
            params["fiscal_year_id"] = fiscal_year_id
        return await self._get(f"/api/accounts/{account_id}/ledger", params=params)

    async def list_verifications(
        self,
        company_id: int,
        fiscal_year_id: int | None = None,
        start_date: str | None = None,
        end_date: str | None = None,
    ) -> list:
        params = {"company_id": company_id}
        if fiscal_year_id:
            params["fiscal_year_id"] = fiscal_year_id
        if start_date:
            params["start_date"] = start_date
        if end_date:
            params["end_date"] = end_date
        return await self._get("/api/verifications/", params=params)

    async def get_verification(self, verification_id: int) -> dict:
        return await self._get(f"/api/verifications/{verification_id}")

    async def list_suppliers(self, company_id: int) -> list:
        return await self._get("/api/suppliers/", params={"company_id": company_id})

    async def get_supplier(self, supplier_id: int) -> dict:
        return await self._get(f"/api/suppliers/{supplier_id}")

    async def list_customers(self, company_id: int) -> list:
        return await self._get("/api/customers/", params={"company_id": company_id})

    async def get_customer(self, customer_id: int) -> dict:
        return await self._get(f"/api/customers/{customer_id}")

    async def list_invoices(self, company_id: int, status: str | None = None) -> list:
        params = {"company_id": company_id}
        if status:
            params["status"] = status
        return await self._get("/api/invoices/", params=params)

    async def get_invoice(self, invoice_id: int) -> dict:
        return await self._get(f"/api/invoices/{invoice_id}")

    async def list_supplier_invoices(self, company_id: int, status: str | None = None) -> list:
        params = {"company_id": company_id}
        if status:
            params["status"] = status
        return await self._get("/api/supplier-invoices/", params=params)

    async def get_supplier_invoice(self, supplier_invoice_id: int) -> dict:
        return await self._get(f"/api/supplier-invoices/{supplier_invoice_id}")

    async def list_expenses(self, company_id: int) -> list:
        return await self._get("/api/expenses/", params={"company_id": company_id})

    async def get_expense(self, expense_id: int) -> dict:
        return await self._get(f"/api/expenses/{expense_id}")

    async def get_balance_sheet(self, company_id: int, fiscal_year_id: int | None = None) -> dict:
        params = {"company_id": company_id}
        if fiscal_year_id:
            params["fiscal_year_id"] = fiscal_year_id
        return await self._get("/api/reports/balance-sheet", params=params)

    async def get_income_statement(self, company_id: int, fiscal_year_id: int | None = None) -> dict:
        params = {"company_id": company_id}
        if fiscal_year_id:
            params["fiscal_year_id"] = fiscal_year_id
        return await self._get("/api/reports/income-statement", params=params)

    async def get_vat_report(self, company_id: int, fiscal_year_id: int | None = None) -> dict:
        params = {"company_id": company_id}
        if fiscal_year_id:
            params["fiscal_year_id"] = fiscal_year_id
        return await self._get("/api/reports/vat-report", params=params)

    async def list_posting_templates(self, company_id: int) -> list:
        return await self._get("/api/posting-templates/", params={"company_id": company_id})

    # --- Write operations ---

    async def create_verification(self, data: dict) -> dict:
        return await self._post("/api/verifications/", json_data=data)

    async def create_supplier(self, data: dict) -> dict:
        return await self._post("/api/suppliers/", json_data=data)

    async def create_customer(self, data: dict) -> dict:
        return await self._post("/api/customers/", json_data=data)

    async def create_account(self, data: dict) -> dict:
        return await self._post("/api/accounts/", json_data=data)

    async def create_supplier_invoice(self, data: dict) -> dict:
        return await self._post("/api/supplier-invoices/", json_data=data)

    async def register_supplier_invoice(self, invoice_id: int) -> dict:
        return await self._post(f"/api/supplier-invoices/{invoice_id}/register")

    async def mark_supplier_invoice_paid(self, invoice_id: int, data: dict) -> dict:
        return await self._post(f"/api/supplier-invoices/{invoice_id}/mark-paid", json_data=data)

    async def create_invoice(self, data: dict) -> dict:
        return await self._post("/api/invoices/", json_data=data)

    async def send_invoice(self, invoice_id: int) -> dict:
        return await self._post(f"/api/invoices/{invoice_id}/send")

    async def mark_invoice_paid(self, invoice_id: int, data: dict) -> dict:
        return await self._post(f"/api/invoices/{invoice_id}/mark-paid", json_data=data)

    async def create_expense(self, data: dict) -> dict:
        return await self._post("/api/expenses/", json_data=data)
