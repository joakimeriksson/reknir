"""Supplier management tools"""
from typing import Any
from mcp.types import Tool, TextContent
from ..client import ReknirClient


def get_supplier_tools() -> list[Tool]:
    """Get all supplier-related tools"""
    return [
        Tool(
            name="find_supplier",
            description=(
                "Find a supplier by organization number or name. "
                "Returns supplier details if found, otherwise returns null. "
                "Use this before creating a new supplier to avoid duplicates."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "org_number": {
                        "type": "string",
                        "description": "Swedish organization number (10 digits, with or without dash)",
                    },
                    "name": {
                        "type": "string",
                        "description": "Supplier name (partial match supported)",
                    },
                },
                "oneOf": [
                    {"required": ["org_number"]},
                    {"required": ["name"]},
                ],
            },
        ),
        Tool(
            name="create_supplier",
            description=(
                "Create a new supplier in Reknir. "
                "Always search for existing supplier first using find_supplier to avoid duplicates."
            ),
            inputSchema={
                "type": "object",
                "properties": {
                    "company_id": {
                        "type": "integer",
                        "description": "Company ID (use get_company_info to get default)",
                    },
                    "name": {
                        "type": "string",
                        "description": "Supplier name",
                    },
                    "org_number": {
                        "type": "string",
                        "description": "Swedish organization number (XXXXXX-XXXX format)",
                    },
                    "email": {
                        "type": "string",
                        "description": "Supplier email address",
                    },
                    "phone": {
                        "type": "string",
                        "description": "Supplier phone number",
                    },
                    "address": {
                        "type": "string",
                        "description": "Supplier address",
                    },
                    "payment_type": {
                        "type": "string",
                        "enum": ["bankgiro", "plusgiro", "bank_account"],
                        "description": "Payment type (bankgiro, plusgiro, or bank_account)",
                    },
                    "bankgiro_number": {
                        "type": "string",
                        "description": "Bankgiro number (when payment_type is bankgiro)",
                    },
                    "plusgiro_number": {
                        "type": "string",
                        "description": "Plusgiro number (when payment_type is plusgiro)",
                    },
                    "clearing_number": {
                        "type": "string",
                        "description": "Bank clearing number (when payment_type is bank_account)",
                    },
                    "account_number": {
                        "type": "string",
                        "description": "Bank account number (when payment_type is bank_account)",
                    },
                },
                "required": ["company_id", "name"],
            },
        ),
        Tool(
            name="list_suppliers",
            description="List all suppliers for a company. Use to browse available suppliers or find by name.",
            inputSchema={
                "type": "object",
                "properties": {
                    "company_id": {
                        "type": "integer",
                        "description": "Company ID (optional, uses default if not provided)",
                    },
                    "active_only": {
                        "type": "boolean",
                        "description": "Only list active suppliers (default: true)",
                        "default": True,
                    },
                },
            },
        ),
    ]


async def handle_supplier_tool(
    name: str, arguments: dict[str, Any], client: ReknirClient
) -> list[TextContent]:
    """Handle supplier tool calls"""

    if name == "find_supplier":
        org_number = arguments.get("org_number")
        name_query = arguments.get("name")

        if org_number:
            # Search by org number
            supplier = await client.find_supplier_by_org_number(org_number)
            if supplier:
                return [
                    TextContent(
                        type="text",
                        text=(
                            f"Found supplier:\n"
                            f"- ID: {supplier['id']}\n"
                            f"- Name: {supplier['name']}\n"
                            f"- Org.nr: {supplier.get('org_number', 'N/A')}\n"
                            f"- Email: {supplier.get('email', 'N/A')}\n"
                            f"- Active: {'Yes' if supplier.get('active', True) else 'No'}"
                        ),
                    )
                ]
            else:
                return [
                    TextContent(
                        type="text",
                        text=f"No supplier found with org number: {org_number}",
                    )
                ]

        elif name_query:
            # Search by name
            suppliers = await client.list_suppliers(active_only=False)
            name_lower = name_query.lower()
            matches = [s for s in suppliers if name_lower in s["name"].lower()]

            if matches:
                result = f"Found {len(matches)} supplier(s):\n\n"
                for s in matches[:5]:  # Limit to 5 results
                    result += (
                        f"- {s['name']} (ID: {s['id']}, "
                        f"Org.nr: {s.get('org_number', 'N/A')})\n"
                    )
                if len(matches) > 5:
                    result += f"\n... and {len(matches) - 5} more"
                return [TextContent(type="text", text=result)]
            else:
                return [TextContent(type="text", text=f"No suppliers found matching: {name_query}")]

    elif name == "create_supplier":
        supplier = await client.create_supplier(arguments)
        return [
            TextContent(
                type="text",
                text=(
                    f"✓ Supplier created successfully!\n"
                    f"- ID: {supplier['id']}\n"
                    f"- Name: {supplier['name']}\n"
                    f"- Org.nr: {supplier.get('org_number', 'N/A')}"
                ),
            )
        ]

    elif name == "list_suppliers":
        company_id = arguments.get("company_id")
        active_only = arguments.get("active_only", True)
        suppliers = await client.list_suppliers(company_id, active_only)

        if not suppliers:
            return [TextContent(type="text", text="No suppliers found.")]

        result = f"Found {len(suppliers)} supplier(s):\n\n"
        for s in suppliers[:20]:  # Limit to 20
            result += f"- {s['name']} (ID: {s['id']}, Org.nr: {s.get('org_number', 'N/A')})\n"
        if len(suppliers) > 20:
            result += f"\n... and {len(suppliers) - 20} more"

        return [TextContent(type="text", text=result)]

    return [TextContent(type="text", text=f"Unknown supplier tool: {name}")]
