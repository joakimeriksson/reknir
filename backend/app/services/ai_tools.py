"""AI tool definitions in OpenAI function-calling format and their handler functions."""

from app.services.ai_api_client import AIAPIClient

# --- Tool classification ---

READ_TOOLS = {
    "get_company_info",
    "list_fiscal_years",
    "list_accounts",
    "get_account_ledger",
    "list_verifications",
    "get_verification",
    "list_suppliers",
    "get_supplier",
    "list_customers",
    "get_customer",
    "list_invoices",
    "get_invoice",
    "list_supplier_invoices",
    "get_supplier_invoice",
    "list_expenses",
    "get_expense",
    "get_balance_sheet",
    "get_income_statement",
    "get_vat_report",
    "list_posting_templates",
}

WRITE_TOOLS = {
    "create_verification",
    "create_supplier",
    "create_customer",
    "create_account",
    "create_supplier_invoice",
    "register_supplier_invoice",
    "mark_supplier_invoice_paid",
    "create_invoice",
    "send_invoice",
    "mark_invoice_paid",
    "create_expense",
}

FORM_TOOLS = {
    "create_verification",
    "create_supplier",
    "create_customer",
    "create_account",
    "create_supplier_invoice",
    "create_invoice",
    "create_expense",
}

# Swedish display names for tool status messages
TOOL_DISPLAY_NAMES = {
    "get_company_info": "Hämtar företagsinformation",
    "list_fiscal_years": "Hämtar räkenskapsår",
    "list_accounts": "Hämtar kontoplan",
    "get_account_ledger": "Hämtar kontoreskontra",
    "list_verifications": "Hämtar verifikationer",
    "get_verification": "Hämtar verifikation",
    "list_suppliers": "Hämtar leverantörer",
    "get_supplier": "Hämtar leverantör",
    "list_customers": "Hämtar kunder",
    "get_customer": "Hämtar kund",
    "list_invoices": "Hämtar fakturor",
    "get_invoice": "Hämtar faktura",
    "list_supplier_invoices": "Hämtar leverantörsfakturor",
    "get_supplier_invoice": "Hämtar leverantörsfaktura",
    "list_expenses": "Hämtar utlägg",
    "get_expense": "Hämtar utlägg",
    "get_balance_sheet": "Hämtar balansräkning",
    "get_income_statement": "Hämtar resultaträkning",
    "get_vat_report": "Hämtar momsrapport",
    "list_posting_templates": "Hämtar konteringsmallar",
    "create_verification": "Skapa verifikation",
    "create_supplier": "Skapa leverantör",
    "create_customer": "Skapa kund",
    "create_account": "Skapa konto",
    "create_supplier_invoice": "Skapa leverantörsfaktura",
    "register_supplier_invoice": "Bokför leverantörsfaktura",
    "mark_supplier_invoice_paid": "Markera leverantörsfaktura som betald",
    "create_invoice": "Skapa faktura",
    "send_invoice": "Skicka faktura",
    "mark_invoice_paid": "Markera faktura som betald",
    "create_expense": "Skapa utlägg",
}


def is_read_tool(tool_name: str) -> bool:
    return tool_name in READ_TOOLS


def is_write_tool(tool_name: str) -> bool:
    return tool_name in WRITE_TOOLS


def get_display_name(tool_name: str) -> str:
    return TOOL_DISPLAY_NAMES.get(tool_name, tool_name)


# --- Tool definitions (OpenAI function-calling format) ---

TOOL_DEFINITIONS = [
    {
        "type": "function",
        "function": {
            "name": "get_company_info",
            "description": "Hämta information om företaget: namn, organisationsnummer, momsstatus, bokföringsmetod, räkenskapsår, betalningsinformation.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_fiscal_years",
            "description": "Lista alla räkenskapsår för företaget.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_accounts",
            "description": "Lista alla konton i kontoplanen. Returnerar samtliga konton med kontonummer, namn, typ och saldo.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_account_ledger",
            "description": "Hämta kontoreskontra (transaktionshistorik) för ett specifikt konto.",
            "parameters": {
                "type": "object",
                "properties": {
                    "account_id": {"type": "integer", "description": "Kontots ID"},
                },
                "required": ["account_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_verifications",
            "description": "Lista verifikationer. Kan filtreras på datum.",
            "parameters": {
                "type": "object",
                "properties": {
                    "start_date": {"type": "string", "description": "Startdatum (YYYY-MM-DD)"},
                    "end_date": {"type": "string", "description": "Slutdatum (YYYY-MM-DD)"},
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_verification",
            "description": "Hämta en specifik verifikation med alla konteringsrader.",
            "parameters": {
                "type": "object",
                "properties": {
                    "verification_id": {"type": "integer", "description": "Verifikationens ID"},
                },
                "required": ["verification_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_suppliers",
            "description": "Lista alla leverantörer för företaget.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_supplier",
            "description": "Hämta detaljerad information om en specifik leverantör.",
            "parameters": {
                "type": "object",
                "properties": {
                    "supplier_id": {"type": "integer", "description": "Leverantörens ID"},
                },
                "required": ["supplier_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_customers",
            "description": "Lista alla kunder för företaget.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_customer",
            "description": "Hämta detaljerad information om en specifik kund.",
            "parameters": {
                "type": "object",
                "properties": {
                    "customer_id": {"type": "integer", "description": "Kundens ID"},
                },
                "required": ["customer_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_invoices",
            "description": "Lista utgående fakturor. Kan filtreras på status.",
            "parameters": {
                "type": "object",
                "properties": {
                    "status": {
                        "type": "string",
                        "description": "Filtrera på status: draft, issued, cancelled",
                        "enum": ["draft", "issued", "cancelled"],
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_invoice",
            "description": "Hämta en specifik utgående faktura med alla rader.",
            "parameters": {
                "type": "object",
                "properties": {
                    "invoice_id": {"type": "integer", "description": "Fakturans ID"},
                },
                "required": ["invoice_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_supplier_invoices",
            "description": "Lista leverantörsfakturor (inkommande fakturor). Kan filtreras på status.",
            "parameters": {
                "type": "object",
                "properties": {
                    "status": {
                        "type": "string",
                        "description": "Filtrera på status: draft, registered, paid, cancelled",
                        "enum": ["draft", "registered", "paid", "cancelled"],
                    },
                },
                "required": [],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_supplier_invoice",
            "description": "Hämta en specifik leverantörsfaktura med alla rader.",
            "parameters": {
                "type": "object",
                "properties": {
                    "supplier_invoice_id": {"type": "integer", "description": "Leverantörsfakturans ID"},
                },
                "required": ["supplier_invoice_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_expenses",
            "description": "Lista utlägg för företaget.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_expense",
            "description": "Hämta ett specifikt utlägg.",
            "parameters": {
                "type": "object",
                "properties": {
                    "expense_id": {"type": "integer", "description": "Utläggets ID"},
                },
                "required": ["expense_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_balance_sheet",
            "description": "Hämta balansräkning för företaget.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_income_statement",
            "description": "Hämta resultaträkning för företaget.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_vat_report",
            "description": "Hämta momsrapport för företaget.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "list_posting_templates",
            "description": "Lista konteringsmallar (bokföringsmallar) för företaget.",
            "parameters": {"type": "object", "properties": {}, "required": []},
        },
    },
    # --- Write tools ---
    {
        "type": "function",
        "function": {
            "name": "create_verification",
            "description": "Skapa en ny verifikation (bokföringspost) med konteringsrader. Varje rad har ett konto, debet och kredit. Summa debet måste vara lika med summa kredit.",
            "parameters": {
                "type": "object",
                "properties": {
                    "description": {"type": "string", "description": "Verifikationstext"},
                    "transaction_date": {"type": "string", "description": "Transaktionsdatum (YYYY-MM-DD)"},
                    "series": {"type": "string", "description": "Verifikationsserie (standard: A)", "default": "A"},
                    "lines": {
                        "type": "array",
                        "description": "Konteringsrader",
                        "items": {
                            "type": "object",
                            "properties": {
                                "account_id": {"type": "integer", "description": "Kontots ID"},
                                "debit": {"type": "number", "description": "Debetbelopp"},
                                "credit": {"type": "number", "description": "Kreditbelopp"},
                                "description": {"type": "string", "description": "Radbeskrivning"},
                            },
                            "required": ["account_id", "debit", "credit"],
                        },
                    },
                },
                "required": ["description", "transaction_date", "lines"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_supplier",
            "description": "Skapa en ny leverantör.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Leverantörens namn"},
                    "org_number": {"type": "string", "description": "Organisationsnummer"},
                    "email": {"type": "string", "description": "E-postadress"},
                    "phone": {"type": "string", "description": "Telefonnummer"},
                    "address": {"type": "string", "description": "Adress"},
                    "postal_code": {"type": "string", "description": "Postnummer"},
                    "city": {"type": "string", "description": "Stad"},
                    "payment_terms_days": {"type": "integer", "description": "Betalningsvillkor i dagar", "default": 30},
                },
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_customer",
            "description": "Skapa en ny kund.",
            "parameters": {
                "type": "object",
                "properties": {
                    "name": {"type": "string", "description": "Kundens namn"},
                    "org_number": {"type": "string", "description": "Organisationsnummer"},
                    "email": {"type": "string", "description": "E-postadress"},
                    "phone": {"type": "string", "description": "Telefonnummer"},
                    "address": {"type": "string", "description": "Adress"},
                    "postal_code": {"type": "string", "description": "Postnummer"},
                    "city": {"type": "string", "description": "Stad"},
                    "payment_terms_days": {"type": "integer", "description": "Betalningsvillkor i dagar", "default": 30},
                },
                "required": ["name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_account",
            "description": "Skapa ett nytt konto i kontoplanen enligt BAS 2024.",
            "parameters": {
                "type": "object",
                "properties": {
                    "account_number": {"type": "integer", "description": "Kontonummer (1000-8999)"},
                    "name": {"type": "string", "description": "Kontonamn"},
                    "description": {"type": "string", "description": "Kontobeskrivning"},
                },
                "required": ["account_number", "name"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_supplier_invoice",
            "description": "Skapa en ny leverantörsfaktura (inkommande faktura).",
            "parameters": {
                "type": "object",
                "properties": {
                    "supplier_id": {"type": "integer", "description": "Leverantörens ID"},
                    "supplier_invoice_number": {"type": "string", "description": "Leverantörens fakturanummer"},
                    "invoice_date": {"type": "string", "description": "Fakturadatum (YYYY-MM-DD)"},
                    "due_date": {"type": "string", "description": "Förfallodatum (YYYY-MM-DD)"},
                    "ocr_number": {"type": "string", "description": "OCR-nummer"},
                    "lines": {
                        "type": "array",
                        "description": "Fakturarader",
                        "items": {
                            "type": "object",
                            "properties": {
                                "description": {"type": "string"},
                                "quantity": {"type": "number", "default": 1},
                                "unit_price": {"type": "number"},
                                "vat_rate": {"type": "number", "description": "Momssats: 0, 6, 12 eller 25"},
                                "account_id": {"type": "integer", "description": "Kostnadskontots ID"},
                            },
                            "required": ["description", "unit_price", "vat_rate"],
                        },
                    },
                },
                "required": ["supplier_id", "invoice_date", "due_date", "lines"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "register_supplier_invoice",
            "description": "Bokför en leverantörsfaktura (skapar verifikation).",
            "parameters": {
                "type": "object",
                "properties": {
                    "supplier_invoice_id": {"type": "integer", "description": "Leverantörsfakturans ID"},
                },
                "required": ["supplier_invoice_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "mark_supplier_invoice_paid",
            "description": "Markera en leverantörsfaktura som betald.",
            "parameters": {
                "type": "object",
                "properties": {
                    "supplier_invoice_id": {"type": "integer", "description": "Leverantörsfakturans ID"},
                    "paid_date": {"type": "string", "description": "Betalningsdatum (YYYY-MM-DD)"},
                    "paid_amount": {"type": "number", "description": "Betalt belopp"},
                },
                "required": ["supplier_invoice_id", "paid_date"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_invoice",
            "description": "Skapa en ny utgående faktura.",
            "parameters": {
                "type": "object",
                "properties": {
                    "customer_id": {"type": "integer", "description": "Kundens ID"},
                    "invoice_date": {"type": "string", "description": "Fakturadatum (YYYY-MM-DD)"},
                    "due_date": {"type": "string", "description": "Förfallodatum (YYYY-MM-DD)"},
                    "reference": {"type": "string", "description": "Kundens referens"},
                    "our_reference": {"type": "string", "description": "Vår referens"},
                    "lines": {
                        "type": "array",
                        "description": "Fakturarader",
                        "items": {
                            "type": "object",
                            "properties": {
                                "description": {"type": "string"},
                                "quantity": {"type": "number", "default": 1},
                                "unit_price": {"type": "number"},
                                "unit": {"type": "string", "default": "st"},
                                "vat_rate": {"type": "number", "description": "Momssats: 0, 6, 12 eller 25"},
                                "account_id": {"type": "integer", "description": "Intäktskontots ID"},
                            },
                            "required": ["description", "unit_price", "vat_rate"],
                        },
                    },
                },
                "required": ["customer_id", "invoice_date", "due_date", "lines"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "send_invoice",
            "description": "Skicka/utfärda en faktura (ändrar status från utkast till utfärdad och skapar verifikation).",
            "parameters": {
                "type": "object",
                "properties": {
                    "invoice_id": {"type": "integer", "description": "Fakturans ID"},
                },
                "required": ["invoice_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "mark_invoice_paid",
            "description": "Markera en utgående faktura som betald.",
            "parameters": {
                "type": "object",
                "properties": {
                    "invoice_id": {"type": "integer", "description": "Fakturans ID"},
                    "paid_date": {"type": "string", "description": "Betalningsdatum (YYYY-MM-DD)"},
                    "paid_amount": {"type": "number", "description": "Betalt belopp"},
                },
                "required": ["invoice_id", "paid_date"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_expense",
            "description": "Skapa ett nytt utlägg.",
            "parameters": {
                "type": "object",
                "properties": {
                    "description": {"type": "string", "description": "Beskrivning av utlägget"},
                    "amount": {"type": "number", "description": "Belopp exkl. moms"},
                    "expense_date": {"type": "string", "description": "Datum (YYYY-MM-DD)"},
                    "employee_name": {"type": "string", "description": "Anställds namn"},
                    "expense_account_id": {"type": "integer", "description": "Kostnadskontots ID"},
                    "vat_amount": {"type": "number", "description": "Momsbelopp i kronor (0 om ej momsregistrerad)"},
                },
                "required": ["description", "amount", "expense_date"],
            },
        },
    },
]


# --- Tool handlers ---


async def execute_tool(
    api_client: AIAPIClient, tool_name: str, args: dict, company_id: int, fiscal_year_id: int | None
) -> dict:
    """Execute a tool and return the result as a dict."""
    try:
        result = await _dispatch_tool(api_client, tool_name, args, company_id, fiscal_year_id)
        return {"success": True, "data": result}
    except Exception as e:
        error_msg = str(e)
        # Extract HTTP error details if available
        if hasattr(e, "response") and e.response is not None:
            try:
                detail = e.response.json().get("detail", error_msg)
                error_msg = str(detail)
            except Exception:
                pass
        return {"success": False, "error": error_msg}


async def _dispatch_tool(
    api_client: AIAPIClient, tool_name: str, args: dict, company_id: int, fiscal_year_id: int | None
) -> dict | list:
    """Route a tool call to the correct API client method."""

    # Read tools
    if tool_name == "get_company_info":
        return await api_client.get_company(company_id)
    elif tool_name == "list_fiscal_years":
        return await api_client.list_fiscal_years(company_id)
    elif tool_name == "list_accounts":
        return await api_client.list_accounts(company_id, fiscal_year_id, args.get("account_type"))
    elif tool_name == "get_account_ledger":
        return await api_client.get_account_ledger(args["account_id"], fiscal_year_id)
    elif tool_name == "list_verifications":
        return await api_client.list_verifications(company_id, fiscal_year_id, args.get("start_date"), args.get("end_date"))
    elif tool_name == "get_verification":
        return await api_client.get_verification(args["verification_id"])
    elif tool_name == "list_suppliers":
        return await api_client.list_suppliers(company_id)
    elif tool_name == "get_supplier":
        return await api_client.get_supplier(args["supplier_id"])
    elif tool_name == "list_customers":
        return await api_client.list_customers(company_id)
    elif tool_name == "get_customer":
        return await api_client.get_customer(args["customer_id"])
    elif tool_name == "list_invoices":
        return await api_client.list_invoices(company_id, args.get("status"))
    elif tool_name == "get_invoice":
        return await api_client.get_invoice(args["invoice_id"])
    elif tool_name == "list_supplier_invoices":
        return await api_client.list_supplier_invoices(company_id, args.get("status"))
    elif tool_name == "get_supplier_invoice":
        return await api_client.get_supplier_invoice(args["supplier_invoice_id"])
    elif tool_name == "list_expenses":
        return await api_client.list_expenses(company_id)
    elif tool_name == "get_expense":
        return await api_client.get_expense(args["expense_id"])
    elif tool_name == "get_balance_sheet":
        return await api_client.get_balance_sheet(company_id, fiscal_year_id)
    elif tool_name == "get_income_statement":
        return await api_client.get_income_statement(company_id, fiscal_year_id)
    elif tool_name == "get_vat_report":
        return await api_client.get_vat_report(company_id, fiscal_year_id)
    elif tool_name == "list_posting_templates":
        return await api_client.list_posting_templates(company_id)

    # Write tools
    elif tool_name == "create_verification":
        data = {
            "company_id": company_id,
            "fiscal_year_id": fiscal_year_id,
            "description": args["description"],
            "transaction_date": args["transaction_date"],
            "series": args.get("series", "A"),
            "transaction_lines": args["lines"],
        }
        return await api_client.create_verification(data)
    elif tool_name == "create_supplier":
        data = {**args, "company_id": company_id}
        return await api_client.create_supplier(data)
    elif tool_name == "create_customer":
        data = {**args, "company_id": company_id}
        return await api_client.create_customer(data)
    elif tool_name == "create_account":
        # Derive account_type from account_number if not provided
        if "account_type" not in args and "account_number" in args:
            num = int(args["account_number"])
            type_map = {
                1: "asset", 2: "equity_liability", 3: "revenue",
                4: "cost_goods", 5: "cost_local", 6: "cost_other",
                7: "cost_personnel", 8: "cost_misc",
            }
            args["account_type"] = type_map.get(num // 1000, "cost_other")
        data = {**args, "company_id": company_id, "fiscal_year_id": fiscal_year_id}
        return await api_client.create_account(data)
    elif tool_name == "create_supplier_invoice":
        lines = args.pop("lines", [])
        for line in lines:
            if "description" not in line:
                line["description"] = args.get("supplier_invoice_number", "")
        data = {**args, "company_id": company_id, "supplier_invoice_lines": lines}
        return await api_client.create_supplier_invoice(data)
    elif tool_name == "register_supplier_invoice":
        return await api_client.register_supplier_invoice(args["supplier_invoice_id"])
    elif tool_name == "mark_supplier_invoice_paid":
        invoice_id = args.pop("supplier_invoice_id")
        return await api_client.mark_supplier_invoice_paid(invoice_id, args)
    elif tool_name == "create_invoice":
        lines = args.pop("lines", [])
        for line in lines:
            if "description" not in line:
                line["description"] = args.get("our_reference", args.get("reference", ""))
        data = {**args, "company_id": company_id, "invoice_lines": lines}
        return await api_client.create_invoice(data)
    elif tool_name == "send_invoice":
        return await api_client.send_invoice(args["invoice_id"])
    elif tool_name == "mark_invoice_paid":
        invoice_id = args.pop("invoice_id")
        return await api_client.mark_invoice_paid(invoice_id, args)
    elif tool_name == "create_expense":
        data = {**args, "company_id": company_id}
        return await api_client.create_expense(data)
    else:
        return {"error": f"Unknown tool: {tool_name}"}
