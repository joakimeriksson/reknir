import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { invoiceApi } from '@/services/api'
import type { Customer, Account, InvoiceLine } from '@/types'
import { getErrorMessage } from '@/utils/errors'

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface InvoiceInitialData {
  customerId?: number
  invoiceDate?: string
  dueDate?: string
  reference?: string
  ourReference?: string
  message?: string
  lines?: Partial<InvoiceLine>[]
}

export interface InvoiceFormProps {
  companyId: number
  customers: Customer[]
  accounts: Account[]
  onSuccess: () => void
  onCancel: () => void
  initialData?: InvoiceInitialData
  renderFooter?: (props: {
    onSubmit: () => void
    onCancel: () => void
    isLoading: boolean
    isValid: boolean
  }) => React.ReactNode
}

// ============================================================================
// Helper Functions
// ============================================================================

function calculateLineTotal(line: InvoiceLine) {
  const net = line.quantity * line.unit_price
  const vat = net * (line.vat_rate / 100)
  return net + vat
}

function calculateTotals(lines: InvoiceLine[]) {
  let totalNet = 0
  let totalVat = 0
  lines.forEach(line => {
    const net = line.quantity * line.unit_price
    const vat = net * (line.vat_rate / 100)
    totalNet += net
    totalVat += vat
  })
  return { totalNet, totalVat, totalAmount: totalNet + totalVat }
}

// ============================================================================
// Main Component
// ============================================================================

export default function InvoiceForm({
  companyId,
  customers,
  accounts,
  onSuccess,
  onCancel,
  initialData,
  renderFooter,
}: InvoiceFormProps) {
  const [customerId, setCustomerId] = useState<number>(initialData?.customerId || 0)
  const [invoiceDate, setInvoiceDate] = useState(initialData?.invoiceDate || new Date().toISOString().split('T')[0])
  const [dueDate, setDueDate] = useState(initialData?.dueDate || '')
  const [reference, setReference] = useState(initialData?.reference || '')
  const [ourReference, setOurReference] = useState(initialData?.ourReference || '')
  const [message, setMessage] = useState(initialData?.message || '')
  const [lines, setLines] = useState<InvoiceLine[]>(
    initialData?.lines?.length
      ? initialData.lines.map(l => ({
          description: l.description || '',
          quantity: l.quantity || 1,
          unit: l.unit || 'st',
          unit_price: l.unit_price || 0,
          vat_rate: l.vat_rate ?? 25,
          account_id: l.account_id,
        }))
      : [{ description: '', quantity: 1, unit: 'st', unit_price: 0, vat_rate: 25 }]
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Update due date when customer changes
  useEffect(() => {
    if (customerId > 0) {
      const customer = customers.find(c => c.id === customerId)
      if (customer) {
        const date = new Date(invoiceDate)
        date.setDate(date.getDate() + customer.payment_terms_days)
        setDueDate(date.toISOString().split('T')[0])
      }
    }
  }, [customerId, invoiceDate, customers])

  const addLine = () => {
    setLines([...lines, { description: '', quantity: 1, unit: 'st', unit_price: 0, vat_rate: 25 }])
  }

  const removeLine = (index: number) => {
    if (lines.length > 1) {
      setLines(lines.filter((_, i) => i !== index))
    }
  }

  const updateLine = (index: number, field: keyof InvoiceLine, value: string | number | undefined) => {
    const newLines = [...lines]
    newLines[index] = { ...newLines[index], [field]: value }
    setLines(newLines)
  }

  const isValid = customerId > 0 && lines.every(l => l.description.trim() !== '')

  const handleSubmit = async () => {
    if (customerId === 0) {
      setError('Välj en kund')
      return
    }

    if (lines.some(l => !l.description)) {
      setError('Alla rader måste ha en beskrivning')
      return
    }

    setSaving(true)
    setError(null)

    try {
      await invoiceApi.create({
        company_id: companyId,
        customer_id: customerId,
        invoice_date: invoiceDate,
        due_date: dueDate,
        reference,
        our_reference: ourReference,
        message,
        invoice_series: 'F',
        invoice_lines: lines.map(line => ({
          description: line.description,
          quantity: line.quantity,
          unit: line.unit,
          unit_price: line.unit_price,
          vat_rate: line.vat_rate,
          account_id: line.account_id,
        })),
      })
      onSuccess()
    } catch (err) {
      console.error('Failed to create invoice:', err)
      setError(getErrorMessage(err, 'Kunde inte skapa faktura'))
    } finally {
      setSaving(false)
    }
  }

  const totals = calculateTotals(lines)

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        {error && (
          <div className="mb-4 p-3 bg-red-100 text-red-700 rounded">
            {error}
          </div>
        )}

        {/* Customer and dates */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Kund *
            </label>
            <select
              value={customerId}
              onChange={(e) => setCustomerId(parseInt(e.target.value))}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              required
            >
              <option value={0}>Välj kund...</option>
              {customers.map(customer => (
                <option key={customer.id} value={customer.id}>
                  {customer.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Fakturadatum *
            </label>
            <input
              type="date"
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Förfallodatum *
            </label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Er referens
            </label>
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Vår referens
            </label>
            <input
              type="text"
              value={ourReference}
              onChange={(e) => setOurReference(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            />
          </div>
        </div>

        {/* Invoice lines */}
        <div className="mb-6">
          <div className="flex justify-between items-center mb-3">
            <h3 className="text-lg font-semibold">Fakturarader</h3>
            <button
              type="button"
              onClick={addLine}
              className="text-sm text-primary-600 hover:text-primary-800"
            >
              + Lägg till rad
            </button>
          </div>

          <div className="space-y-3">
            {lines.map((line, index) => (
              <div key={index} className="space-y-2 p-3 bg-gray-50 rounded">
                <div className="grid grid-cols-12 gap-2 items-start">
                  <div className="col-span-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Beskrivning *
                    </label>
                    <input
                      type="text"
                      placeholder="Beskrivning av vara/tjänst"
                      value={line.description}
                      onChange={(e) => updateLine(index, 'description', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-primary-500"
                      required
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Antal *
                    </label>
                    <input
                      type="number"
                      placeholder="1"
                      value={line.quantity || ''}
                      onChange={(e) => {
                        const value = e.target.value === '' ? 0 : parseFloat(e.target.value) || 0
                        updateLine(index, 'quantity', value)
                      }}
                      step="1"
                      min="0"
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-primary-500"
                      required
                    />
                  </div>
                  <div className="col-span-1">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Enhet
                    </label>
                    <input
                      type="text"
                      placeholder="st"
                      value={line.unit}
                      onChange={(e) => updateLine(index, 'unit', e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-primary-500"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      À-pris *
                    </label>
                    <input
                      type="number"
                      placeholder="0,00"
                      value={line.unit_price || ''}
                      onChange={(e) => {
                        const value = e.target.value === '' ? 0 : parseFloat(e.target.value) || 0
                        updateLine(index, 'unit_price', value)
                      }}
                      step="0.01"
                      min="0"
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-primary-500"
                      required
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Moms *
                    </label>
                    <select
                      value={line.vat_rate}
                      onChange={(e) => updateLine(index, 'vat_rate', parseFloat(e.target.value))}
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-primary-500"
                    >
                      <option value={0}>0%</option>
                      <option value={6}>6%</option>
                      <option value={12}>12%</option>
                      <option value={25}>25%</option>
                    </select>
                  </div>
                  <div className="col-span-1">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      &nbsp;
                    </label>
                    <div className="flex justify-center">
                      {lines.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeLine(index)}
                          className="text-red-600 hover:text-red-800 p-2"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-12 md:col-span-5">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Intäktskonto
                    </label>
                    <select
                      value={line.account_id || ''}
                      onChange={(e) => updateLine(index, 'account_id', e.target.value ? parseInt(e.target.value) : undefined)}
                      className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-primary-500 text-sm"
                    >
                      <option value="">Auto (baserat på moms)</option>
                      {accounts.filter(a => a.account_number >= 3000 && a.account_number < 4000).map(account => (
                        <option key={account.id} value={account.id}>
                          {account.account_number} - {account.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-12 md:col-span-6 text-right font-mono text-sm">
                    Totalt: {calculateLineTotal(line).toLocaleString('sv-SE')} kr
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Totals */}
        <div className="bg-gray-50 p-4 rounded mb-6">
          <div className="flex justify-between text-sm mb-1">
            <span>Netto:</span>
            <span className="font-mono">{totals.totalNet.toLocaleString('sv-SE', { style: 'currency', currency: 'SEK' })}</span>
          </div>
          <div className="flex justify-between text-sm mb-2">
            <span>Moms:</span>
            <span className="font-mono">{totals.totalVat.toLocaleString('sv-SE', { style: 'currency', currency: 'SEK' })}</span>
          </div>
          <div className="flex justify-between text-lg font-bold border-t pt-2">
            <span>Totalt:</span>
            <span className="font-mono">{totals.totalAmount.toLocaleString('sv-SE', { style: 'currency', currency: 'SEK' })}</span>
          </div>
        </div>

        {/* Message */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Meddelande (visas på fakturan)
          </label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={3}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            placeholder="T.ex. betalningsvillkor eller övrig information..."
          />
        </div>
      </div>

      {/* Footer */}
      {renderFooter ? (
        renderFooter({
          onSubmit: handleSubmit,
          onCancel,
          isLoading: saving,
          isValid,
        })
      ) : (
        <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 bg-white sticky bottom-0">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Avbryt
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
          >
            {saving ? 'Skapar...' : 'Skapa faktura'}
          </button>
        </div>
      )}
    </div>
  )
}
