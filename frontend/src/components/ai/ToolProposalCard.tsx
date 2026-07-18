import { useState } from 'react'
import { Check, X } from 'lucide-react'
import type { ToolProposal } from '@/types'

interface ToolProposalCardProps {
  proposal: ToolProposal
  onApprove: (messageId: number, approved: boolean, updatedArgs?: Record<string, unknown>) => void
}

// Fields that should be hidden (internal IDs)
const HIDDEN_FIELDS = new Set([
  'company_id',
  'fiscal_year_id',
])

// Fields that are complex (arrays/objects) and shown read-only
function isComplexField(value: unknown): boolean {
  return Array.isArray(value) || (typeof value === 'object' && value !== null)
}

function formatFieldName(name: string): string {
  const translations: Record<string, string> = {
    description: 'Beskrivning',
    transaction_date: 'Datum',
    series: 'Serie',
    lines: 'Konteringsrader',
    name: 'Namn',
    org_number: 'Org.nummer',
    email: 'E-post',
    phone: 'Telefon',
    address: 'Adress',
    postal_code: 'Postnummer',
    city: 'Stad',
    payment_terms_days: 'Betalningsvillkor (dagar)',
    account_number: 'Kontonummer',
    supplier_id: 'Leverantör (ID)',
    customer_id: 'Kund (ID)',
    account_id: 'Konto (ID)',
    invoice_date: 'Fakturadatum',
    due_date: 'Förfallodatum',
    supplier_invoice_number: 'Leverantörens fakturanr',
    ocr_number: 'OCR-nummer',
    reference: 'Referens',
    our_reference: 'Vår referens',
    paid_date: 'Betalningsdatum',
    paid_amount: 'Betalt belopp',
    amount: 'Belopp',
    expense_date: 'Datum',
    employee_name: 'Anställd',
    vat_rate: 'Momssats',
    quantity: 'Antal',
    unit_price: 'Á-pris',
    unit: 'Enhet',
    supplier_invoice_id: 'Leverantörsfaktura (ID)',
    invoice_id: 'Faktura (ID)',
  }
  return translations[name] || name
}

function formatComplexValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value
      .map((item, i) => {
        if (typeof item === 'object' && item !== null) {
          const parts: string[] = []
          const obj = item as Record<string, unknown>
          if (obj.description) parts.push(String(obj.description))
          if (obj.debit && Number(obj.debit) > 0) parts.push(`Debet: ${obj.debit}`)
          if (obj.credit && Number(obj.credit) > 0) parts.push(`Kredit: ${obj.credit}`)
          if (obj.unit_price) parts.push(`${obj.quantity || 1} x ${obj.unit_price}`)
          if (obj.vat_rate !== undefined) parts.push(`Moms: ${obj.vat_rate}%`)
          if (obj.account_id) parts.push(`Konto-ID: ${obj.account_id}`)
          return `${i + 1}. ${parts.join(', ')}`
        }
        return String(item)
      })
      .join('\n')
  }
  return JSON.stringify(value, null, 2)
}

export default function ToolProposalCard({ proposal, onApprove }: ToolProposalCardProps) {
  const [editedArgs, setEditedArgs] = useState<Record<string, unknown>>({ ...proposal.tool_args })

  const handleFieldChange = (field: string, value: string) => {
    setEditedArgs((prev) => ({ ...prev, [field]: value }))
  }

  const handleApprove = () => {
    // Only send fields that were actually changed
    const changedArgs: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(editedArgs)) {
      if (JSON.stringify(value) !== JSON.stringify(proposal.tool_args[key])) {
        changedArgs[key] = value
      }
    }
    onApprove(
      proposal.message_id,
      true,
      Object.keys(changedArgs).length > 0 ? changedArgs : undefined
    )
  }

  const handleDeny = () => {
    onApprove(proposal.message_id, false)
  }

  const entries = Object.entries(proposal.tool_args).filter(
    ([key]) => !HIDDEN_FIELDS.has(key)
  )

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
      <h4 className="text-sm font-semibold text-amber-800 mb-3">
        {proposal.display_name}
      </h4>

      <div className="space-y-2.5 mb-4">
        {entries.map(([key, value]) => (
          <div key={key}>
            <label className="block text-xs font-medium text-gray-600 mb-0.5">
              {formatFieldName(key)}
            </label>
            {isComplexField(value) ? (
              <pre className="text-xs bg-white border border-gray-200 rounded-lg p-2.5 whitespace-pre-wrap text-gray-700 font-mono">
                {formatComplexValue(value)}
              </pre>
            ) : (
              <input
                type="text"
                value={String(editedArgs[key] ?? '')}
                onChange={(e) => handleFieldChange(key, e.target.value)}
                className="w-full text-sm px-3 py-1.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500"
              />
            )}
          </div>
        ))}
      </div>

      <div className="flex gap-2">
        <button
          onClick={handleApprove}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors"
        >
          <Check className="w-4 h-4" />
          Godkänn
        </button>
        <button
          onClick={handleDeny}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-700 bg-gray-200 rounded-lg hover:bg-gray-300 transition-colors"
        >
          <X className="w-4 h-4" />
          Avbryt
        </button>
      </div>
    </div>
  )
}
