import { useEffect, useState, useMemo } from 'react'
import { X } from 'lucide-react'
import { supplierInvoiceApi, attachmentApi } from '@/services/api'
import AttachmentManager from '@/components/AttachmentManager'
import AccountCombobox from '@/components/forms/AccountCombobox'
import type { Supplier, Account, InvoiceLine, EntityAttachment } from '@/types'
import { getErrorMessage } from '@/utils/errors'

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface SupplierInvoiceInitialData {
  supplierId?: number
  supplierInvoiceNumber?: string
  invoiceDate?: string
  dueDate?: string
  ocrNumber?: string
  reference?: string
  lines?: Partial<InvoiceLine>[]
  pendingAttachmentIds?: number[]
}

export interface SupplierInvoiceFormProps {
  companyId: number
  suppliers: Supplier[]
  accounts: Account[]
  onSuccess: () => void
  onCancel: () => void
  initialData?: SupplierInvoiceInitialData
  renderFooter?: (props: {
    onSubmit: () => void
    onCancel: () => void
    isLoading: boolean
    isValid: boolean
  }) => React.ReactNode
  onAttachmentsChange?: (attachments: EntityAttachment[]) => void
  onAttachmentClick?: (attachment: EntityAttachment, index: number) => void
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

export default function SupplierInvoiceForm({
  companyId,
  suppliers,
  accounts,
  onSuccess,
  onCancel,
  initialData,
  renderFooter,
  onAttachmentsChange,
  onAttachmentClick,
}: SupplierInvoiceFormProps) {
  const [supplierId, setSupplierId] = useState<number>(initialData?.supplierId || 0)
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState(initialData?.supplierInvoiceNumber || '')
  const [invoiceDate, setInvoiceDate] = useState(initialData?.invoiceDate || new Date().toISOString().split('T')[0])
  const [dueDate, setDueDate] = useState(initialData?.dueDate || '')
  const [ocrNumber, setOcrNumber] = useState(initialData?.ocrNumber || '')
  const [reference, setReference] = useState(initialData?.reference || '')
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
  const [pendingAttachmentIds, setPendingAttachmentIds] = useState<number[]>(initialData?.pendingAttachmentIds || [])

  const expenseAccounts = useMemo(
    () => accounts.filter(a => a.account_number >= 4000 && a.account_number < 8000),
    [accounts]
  )

  // Update due date when supplier changes
  useEffect(() => {
    if (supplierId > 0) {
      const supplier = suppliers.find(s => s.id === supplierId)
      if (supplier) {
        const date = new Date(invoiceDate)
        date.setDate(date.getDate() + supplier.payment_terms_days)
        setDueDate(date.toISOString().split('T')[0])
      }
    }
  }, [supplierId, invoiceDate, suppliers])

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

  const isValid = supplierId > 0 &&
    supplierInvoiceNumber.trim() !== '' &&
    lines.every(l => l.description.trim() !== '')

  const handleSubmit = async () => {
    if (supplierId === 0) {
      setError('Välj en leverantör')
      return
    }

    if (!supplierInvoiceNumber) {
      setError('Ange leverantörens fakturanummer')
      return
    }

    if (lines.some(l => !l.description)) {
      setError('Alla rader måste ha en beskrivning')
      return
    }

    setSaving(true)
    setError(null)

    try {
      const response = await supplierInvoiceApi.create({
        company_id: companyId,
        supplier_id: supplierId,
        supplier_invoice_number: supplierInvoiceNumber,
        invoice_date: invoiceDate,
        due_date: dueDate,
        ocr_number: ocrNumber || undefined,
        reference: reference || undefined,
        supplier_invoice_lines: lines.map(line => ({
          description: line.description,
          quantity: line.quantity,
          unit: line.unit,
          unit_price: line.unit_price,
          vat_rate: line.vat_rate,
          account_id: line.account_id,
        })),
      })
      const newInvoiceId = response.data.id!

      // Link pending attachments to the new supplier invoice
      for (const attachmentId of pendingAttachmentIds) {
        await supplierInvoiceApi.linkAttachment(newInvoiceId, attachmentId)
      }

      onSuccess()
    } catch (err) {
      console.error('Failed to create supplier invoice:', err)
      setError(getErrorMessage(err, 'Kunde inte skapa leverantörsfaktura'))
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

        {/* Supplier and dates */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Leverantör *
            </label>
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(parseInt(e.target.value))}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              required
            >
              <option value={0}>Välj leverantör...</option>
              {suppliers.map(supplier => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Fakturanummer *
            </label>
            <input
              type="text"
              value={supplierInvoiceNumber}
              onChange={(e) => setSupplierInvoiceNumber(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
              placeholder="Leverantörens fakturanummer"
              required
            />
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
              OCR-nummer
            </label>
            <input
              type="text"
              value={ocrNumber}
              onChange={(e) => setOcrNumber(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Referens
            </label>
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
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
                      step="0.01"
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
                      Kostnadskonto
                    </label>
                    <AccountCombobox
                      accounts={expenseAccounts}
                      value={line.account_id || 0}
                      onChange={(id) => updateLine(index, 'account_id', id || undefined)}
                      placeholder="Auto (6570 - Övriga externa tjänster)"
                    />
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

        {/* Attachments */}
        <div className="mb-6">
          <AttachmentManager
            attachments={[]}
            config={{
              allowUpload: true,
              allowDelete: true,
            }}
            labels={{
              title: 'Bilagor',
              emptyState: 'Inga bilagor',
              uploadButton: 'Ladda upp',
              deleteConfirm: (f) => `Ta bort ${f}?`,
            }}
            onUpload={async (file) => {
              const res = await attachmentApi.upload(companyId, file)
              setPendingAttachmentIds(prev => [...prev, res.data.id])
            }}
            onDelete={async () => {}}
            onDownload={async () => {}}
            companyId={companyId}
            pendingMode={true}
            pendingAttachmentIds={pendingAttachmentIds}
            onPendingSelectionChange={setPendingAttachmentIds}
            onAttachmentClick={onAttachmentClick}
            disableInternalPreview={!!onAttachmentClick}
            onVisibleAttachmentsChange={onAttachmentsChange}
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
            {saving ? 'Registrerar...' : 'Registrera faktura'}
          </button>
        </div>
      )}
    </div>
  )
}
