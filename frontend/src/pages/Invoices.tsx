import { useEffect, useState } from 'react'
import { Download, Plus, Eye, DollarSign, Send, FileText } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import api, { invoiceApi, supplierInvoiceApi, customerApi, supplierApi, accountApi } from '@/services/api'
import DraggableModal from '@/components/DraggableModal'
import { ModalType } from '@/contexts/LayoutSettingsContext'
import InvoiceForm from '@/components/forms/InvoiceForm'
import SupplierInvoiceForm from '@/components/forms/SupplierInvoiceForm'
import type { InvoiceListItem, SupplierInvoiceListItem, Customer, Supplier, Account, EntityAttachment } from '@/types'
import { InvoiceStatus, PaymentStatus } from '@/types'
import { getErrorMessage } from '@/utils/errors'
import { useCompany } from '@/contexts/CompanyContext'
import { useAIForm } from '@/contexts/AIFormContext'
import { aiApi } from '@/services/api'
import { useFiscalYear } from '@/contexts/FiscalYearContext'
import FiscalYearSelector from '@/components/FiscalYearSelector'
import { useAttachmentPreviewController } from '@/hooks/useAttachmentPreviewController'
import { useSortableTable } from '@/hooks/useSortableTable'
import SortableHeader from '@/components/SortableHeader'
import { useToast } from '@/contexts/ToastContext'

// Format number with Swedish thousand separators (space)
const formatNumberWithSeparator = (value: number): string => {
  if (isNaN(value)) return ''
  return value.toLocaleString('sv-SE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

// Parse formatted string back to number
const parseFormattedNumber = (value: string): number => {
  // Remove spaces and replace comma with dot for decimal
  const cleaned = value.replace(/\s/g, '').replace(',', '.')
  const parsed = parseFloat(cleaned)
  return isNaN(parsed) ? 0 : parsed
}

export default function Invoices() {
  const navigate = useNavigate()
  const { showToast } = useToast()
  const { selectedCompany } = useCompany()
  const { selectedFiscalYear } = useFiscalYear()
  const [invoices, setInvoices] = useState<InvoiceListItem[]>([])
  const [supplierInvoices, setSupplierInvoices] = useState<SupplierInvoiceListItem[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreateInvoiceModal, setShowCreateInvoiceModal] = useState(false)
  const [showCreateSupplierInvoiceModal, setShowCreateSupplierInvoiceModal] = useState(false)
  // Confirmation modal states
  const [confirmSendInvoice, setConfirmSendInvoice] = useState<InvoiceListItem | null>(null)
  const [confirmRegisterSupplierInvoice, setConfirmRegisterSupplierInvoice] = useState<SupplierInvoiceListItem | null>(null)
  const [sendingInvoice, setSendingInvoice] = useState(false)
  const [registeringSupplierInvoice, setRegisteringSupplierInvoice] = useState(false)
  // Payment modal states
  const [confirmPayInvoice, setConfirmPayInvoice] = useState<InvoiceListItem | null>(null)
  const [confirmPaySupplierInvoice, setConfirmPaySupplierInvoice] = useState<SupplierInvoiceListItem | null>(null)
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().split('T')[0])
  const [paymentAmount, setPaymentAmount] = useState<number>(0)
  const [paymentError, setPaymentError] = useState<string | null>(null)
  const [payingInvoice, setPayingInvoice] = useState(false)
  const [payingSupplierInvoice, setPayingSupplierInvoice] = useState(false)

  // AI form integration
  const { pendingForm, clearForm } = useAIForm()
  const [invoiceInitialData, setInvoiceInitialData] = useState<Record<string, unknown> | undefined>()
  const [supplierInvoiceInitialData, setSupplierInvoiceInitialData] = useState<Record<string, unknown> | undefined>()

  useEffect(() => {
    if (!pendingForm) return
    if (pendingForm.type === 'invoice') {
      const d = pendingForm.data
      setInvoiceInitialData({
        customerId: d.customer_id,
        invoiceDate: d.invoice_date,
        dueDate: d.due_date,
        reference: d.reference,
        ourReference: d.our_reference,
        message: d.message,
        lines: d.lines,
      })
      setShowCreateInvoiceModal(true)
      clearForm()
    } else if (pendingForm.type === 'supplier_invoice') {
      const d = pendingForm.data
      const uploadIds = pendingForm.aiUploadIds || []
      clearForm()

      const copyUploads = async () => {
        const attachmentIds: number[] = []
        for (const uploadId of uploadIds) {
          try {
            const resp = await aiApi.copyToAttachment(uploadId)
            attachmentIds.push(resp.data.id)
          } catch { /* ignore */ }
        }
        setSupplierInvoiceInitialData({
          supplierId: d.supplier_id,
          supplierInvoiceNumber: d.supplier_invoice_number,
          invoiceDate: d.invoice_date,
          dueDate: d.due_date,
          ocrNumber: d.ocr_number,
          reference: d.reference,
          lines: d.lines,
          pendingAttachmentIds: attachmentIds,
        })
        setShowCreateSupplierInvoiceModal(true)
      }
      copyUploads()
    }
  }, [pendingForm, clearForm])

  // Filter states
  const [invoiceFilter, setInvoiceFilter] = useState<string>('all')
  const [supplierInvoiceFilter, setSupplierInvoiceFilter] = useState<string>('all')

  // Track attachments from supplier invoice form for preview controller
  const [supplierInvoiceAttachments, setSupplierInvoiceAttachments] = useState<EntityAttachment[]>([])

  // Attachment preview controller for supplier invoice modal
  const {
    openPreview: openSupplierInvoicePreview,
    reset: resetSupplierInvoicePreview,
    floatingPreview: supplierInvoiceFloatingPreview,
    pinnedPreview: supplierInvoicePinnedPreview,
    canPin: supplierInvoiceCanPin,
    isPinned: supplierInvoiceIsPinned,
    togglePinned: supplierInvoiceTogglePinned,
  } = useAttachmentPreviewController(supplierInvoiceAttachments, {
    modalType: ModalType.SUPPLIER_INVOICE,
  })

  // Sorting for customer invoices
  const { sortedData: sortedInvoices, sortConfig: invoiceSortConfig, requestSort: requestInvoiceSort } = useSortableTable(
    invoices,
    { key: 'invoice_date', direction: 'desc' }
  )

  // Sorting for supplier invoices
  const { sortedData: sortedSupplierInvoices, sortConfig: supplierInvoiceSortConfig, requestSort: requestSupplierInvoiceSort } = useSortableTable(
    supplierInvoices,
    { key: 'invoice_date', direction: 'desc' }
  )

  useEffect(() => {
    loadInvoices()
  }, [selectedCompany, selectedFiscalYear])

  const loadInvoices = async () => {
    if (!selectedCompany || !selectedFiscalYear) {
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      const [outgoingRes, incomingRes, customersRes, suppliersRes, accountsRes] = await Promise.all([
        invoiceApi.list(selectedCompany.id, { fiscal_year_id: selectedFiscalYear.id }),
        supplierInvoiceApi.list(selectedCompany.id, { fiscal_year_id: selectedFiscalYear.id }),
        customerApi.list(selectedCompany.id),
        supplierApi.list(selectedCompany.id),
        accountApi.list(selectedCompany.id, selectedFiscalYear.id),
      ])
      setInvoices(outgoingRes.data)
      setSupplierInvoices(incomingRes.data)
      setCustomers(customersRes.data)
      setSuppliers(suppliersRes.data)
      setAccounts(accountsRes.data)
    } catch (error) {
      console.error('Failed to load invoices:', error)
    } finally {
      setLoading(false)
    }
  }

  const downloadInvoicePdf = async (invoiceId: number, invoiceNumber: string) => {
    try {
      // Use axios to download with authentication
      const response = await api.get(`/invoices/${invoiceId}/pdf`, {
        responseType: 'blob'
      })

      // Create blob URL and download
      const blob = new Blob([response.data], { type: 'application/pdf' })
      const url = window.URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `faktura_${invoiceNumber}.pdf`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Failed to download PDF:', error)
      showToast('Kunde inte ladda ner PDF', 'error')
    }
  }

  const handleSendInvoice = async () => {
    if (!confirmSendInvoice) return

    setSendingInvoice(true)
    try {
      await invoiceApi.send(confirmSendInvoice.id)
      await loadInvoices()
      setConfirmSendInvoice(null)
    } catch (error) {
      console.error('Failed to send invoice:', error)
      showToast('Kunde inte skicka fakturan', 'error')
    } finally {
      setSendingInvoice(false)
    }
  }

  const handleRegisterSupplierInvoice = async () => {
    if (!confirmRegisterSupplierInvoice) return

    setRegisteringSupplierInvoice(true)
    try {
      await supplierInvoiceApi.register(confirmRegisterSupplierInvoice.id)
      await loadInvoices()
      setConfirmRegisterSupplierInvoice(null)
    } catch (error) {
      console.error('Failed to register supplier invoice:', error)
      showToast(selectedCompany?.accounting_basis === 'accrual'
        ? 'Kunde inte bokföra leverantörsfakturan'
        : 'Kunde inte registrera leverantörsfakturan', 'error')
    } finally {
      setRegisteringSupplierInvoice(false)
    }
  }

  const handlePayInvoice = async () => {
    if (!confirmPayInvoice) return

    // Validate payment amount
    const remainingAmount = confirmPayInvoice.total_amount - confirmPayInvoice.paid_amount
    if (paymentAmount <= 0) {
      setPaymentError('Belopp måste vara större än 0')
      return
    }
    if (paymentAmount > remainingAmount) {
      setPaymentError(`Belopp kan inte överstiga återstående belopp (${remainingAmount.toLocaleString('sv-SE')} kr)`)
      return
    }

    // Find bank account 1930 (default bank account)
    const bankAccount = accounts.find(a => a.account_number === 1930)

    if (!bankAccount) {
      setPaymentError('Bankkonto 1930 hittades inte. Lägg till konto 1930 (Företagskonto/Bankgiro) först.')
      return
    }

    setPayingInvoice(true)
    try {
      await invoiceApi.markPaid(confirmPayInvoice.id, {
        paid_date: paymentDate,
        paid_amount: paymentAmount,
        bank_account_id: bankAccount.id
      })
      await loadInvoices()
      setConfirmPayInvoice(null)
      const isPartialPayment = paymentAmount < remainingAmount
      showToast(isPartialPayment
        ? `Delbetalning på ${paymentAmount.toLocaleString('sv-SE')} kr har registrerats`
        : 'Fakturan har markerats som betald och en betalningsverifikation har skapats', 'success')
    } catch (error) {
      console.error('Failed to mark invoice as paid:', error)
      showToast(`Kunde inte markera som betald: ${getErrorMessage(error, 'Unknown error')}`, 'error')
    } finally {
      setPayingInvoice(false)
    }
  }

  const handlePaySupplierInvoice = async () => {
    if (!confirmPaySupplierInvoice) return

    // Validate payment amount
    const remainingAmount = confirmPaySupplierInvoice.total_amount - confirmPaySupplierInvoice.paid_amount
    if (paymentAmount <= 0) {
      setPaymentError('Belopp måste vara större än 0')
      return
    }
    if (paymentAmount > remainingAmount) {
      setPaymentError(`Belopp kan inte överstiga återstående belopp (${remainingAmount.toLocaleString('sv-SE')} kr)`)
      return
    }

    // Find bank account 1930 (default bank account)
    const bankAccount = accounts.find(a => a.account_number === 1930)

    if (!bankAccount) {
      setPaymentError('Bankkonto 1930 hittades inte. Lägg till konto 1930 (Företagskonto/Bankgiro) först.')
      return
    }

    setPayingSupplierInvoice(true)
    try {
      await supplierInvoiceApi.markPaid(confirmPaySupplierInvoice.id, {
        paid_date: paymentDate,
        paid_amount: paymentAmount,
        bank_account_id: bankAccount.id
      })
      await loadInvoices()
      setConfirmPaySupplierInvoice(null)
      const isPartialPayment = paymentAmount < remainingAmount
      showToast(isPartialPayment
        ? `Delbetalning på ${paymentAmount.toLocaleString('sv-SE')} kr har registrerats`
        : 'Leverantörsfakturan har markerats som betald och en betalningsverifikation har skapats', 'success')
    } catch (error) {
      console.error('Failed to mark supplier invoice as paid:', error)
      showToast(`Kunde inte markera som betald: ${getErrorMessage(error, 'Unknown error')}`, 'error')
    } finally {
      setPayingSupplierInvoice(false)
    }
  }

  const getStatusBadge = (status: InvoiceStatus, paymentStatus: PaymentStatus, dueDate: string) => {
    // Check if overdue: issued + not paid + due_date < today
    const isOverdue = status === InvoiceStatus.ISSUED &&
                      paymentStatus !== PaymentStatus.PAID &&
                      new Date(dueDate) < new Date()

    // Document status styling
    const statusConfig = {
      [InvoiceStatus.DRAFT]: { color: 'bg-gray-200 text-gray-800', label: 'UTKAST' },
      [InvoiceStatus.ISSUED]: { color: 'bg-blue-200 text-blue-800', label: 'SKICKAD' },
      [InvoiceStatus.CANCELLED]: { color: 'bg-gray-400 text-gray-900', label: 'MAKULERAD' },
    }

    // Payment status styling
    const paymentConfig = {
      [PaymentStatus.UNPAID]: { color: 'bg-yellow-100 text-yellow-800', label: 'OBETALD' },
      [PaymentStatus.PARTIALLY_PAID]: { color: 'bg-orange-200 text-orange-800', label: 'DELBETALD' },
      [PaymentStatus.PAID]: { color: 'bg-green-200 text-green-800', label: 'BETALD' },
    }

    const statusStyle = statusConfig[status] || { color: 'bg-gray-200', label: status }
    const paymentStyle = paymentConfig[paymentStatus] || { color: 'bg-gray-200', label: paymentStatus }

    return (
      <div className="flex gap-1 flex-wrap">
        <span className={`px-2 py-1 text-xs rounded ${statusStyle.color}`}>
          {statusStyle.label}
        </span>
        {status !== InvoiceStatus.DRAFT && status !== InvoiceStatus.CANCELLED && (
          <span className={`px-2 py-1 text-xs rounded ${isOverdue ? 'bg-red-200 text-red-800' : paymentStyle.color}`}>
            {isOverdue ? 'FÖRFALLEN' : paymentStyle.label}
          </span>
        )}
      </div>
    )
  }

  const isInvoiceOverdue = (status: InvoiceStatus, paymentStatus: PaymentStatus, dueDate: string) =>
    status === InvoiceStatus.ISSUED &&
    paymentStatus !== PaymentStatus.PAID &&
    new Date(dueDate) < new Date()

  const filterInvoices = <T extends { status: InvoiceStatus; payment_status: PaymentStatus; due_date: string }>(
    items: T[],
    filter: string
  ): T[] => {
    if (filter === 'all') return items
    return items.filter((inv) => {
      const overdue = isInvoiceOverdue(inv.status, inv.payment_status, inv.due_date)
      switch (filter) {
        case 'draft': return inv.status === InvoiceStatus.DRAFT
        case 'issued': return inv.status === InvoiceStatus.ISSUED && !overdue
        case 'overdue': return overdue
        case 'paid': return inv.payment_status === PaymentStatus.PAID
        case 'cancelled': return inv.status === InvoiceStatus.CANCELLED
        default: return true
      }
    })
  }

  const filteredInvoices = filterInvoices(sortedInvoices, invoiceFilter)
  const filteredSupplierInvoices = filterInvoices(sortedSupplierInvoices, supplierInvoiceFilter)

  const filterButtons = [
    { key: 'all', label: 'Alla' },
    { key: 'draft', label: 'Utkast' },
    { key: 'issued', label: 'Skickade' },
    { key: 'overdue', label: 'Förfallna' },
    { key: 'paid', label: 'Betalda' },
    { key: 'cancelled', label: 'Makulerade' },
  ]

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Laddar fakturor...</p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <h1 className="text-3xl font-bold">Fakturor</h1>
        <FiscalYearSelector />
      </div>

      {/* Outgoing Invoices */}
      <div className="mb-8">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold">Kundfakturor (Utgående)</h2>
          <button
            onClick={() => setShowCreateInvoiceModal(true)}
            className="btn btn-primary inline-flex items-center"
          >
            <Plus className="w-4 h-4 mr-2" />
            Ny faktura
          </button>
        </div>

        <div className="flex gap-2 mb-4 flex-wrap">
          {filterButtons.map((f) => (
            <button
              key={f.key}
              onClick={() => setInvoiceFilter(f.key)}
              className={`px-3 py-1 text-sm rounded-full transition-colors ${
                invoiceFilter === f.key
                  ? 'bg-primary-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {invoices.length === 0 ? (
          <div className="card">
            <p className="text-gray-600">Inga kundfakturor ännu. Skapa din första faktura!</p>
          </div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead>
                <tr>
                  <SortableHeader label="Fakturanr" sortKey="invoice_number" sortConfig={invoiceSortConfig} onSort={requestInvoiceSort} />
                  <SortableHeader label="Datum" sortKey="invoice_date" sortConfig={invoiceSortConfig} onSort={requestInvoiceSort} />
                  <SortableHeader label="Kund" sortKey="customer_name" sortConfig={invoiceSortConfig} onSort={requestInvoiceSort} />
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Status
                  </th>
                  <SortableHeader label="Belopp" sortKey="total_amount" sortConfig={invoiceSortConfig} onSort={requestInvoiceSort} align="right" />
                  <SortableHeader label="Betalt" sortKey="paid_amount" sortConfig={invoiceSortConfig} onSort={requestInvoiceSort} align="right" />
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                    Åtgärder
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredInvoices.map((invoice) => {
                  const overdue = isInvoiceOverdue(invoice.status, invoice.payment_status, invoice.due_date)
                  return (
                  <tr
                    key={invoice.id}
                    onClick={() => navigate(`/invoices/${invoice.id}`)}
                    className={`cursor-pointer ${overdue ? 'bg-red-50 hover:bg-red-100' : 'hover:bg-gray-50'}`}
                  >
                    <td className="px-4 py-3 text-sm font-medium">
                      {invoice.invoice_number}
                    </td>
                    <td className="px-4 py-3 text-sm">{invoice.invoice_date}</td>
                    <td className="px-4 py-3 text-sm">{invoice.customer_name}</td>
                    <td className="px-4 py-3 text-sm">{getStatusBadge(invoice.status, invoice.payment_status, invoice.due_date)}</td>
                    <td className="px-4 py-3 text-sm text-right font-mono">
                      {invoice.total_amount.toLocaleString('sv-SE', {
                        style: 'currency',
                        currency: 'SEK',
                      })}
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-mono">
                      {invoice.paid_amount.toLocaleString('sv-SE', {
                        style: 'currency',
                        currency: 'SEK',
                      })}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => navigate(`/invoices/${invoice.id}`)}
                          className="p-1 text-gray-600 hover:text-gray-800"
                          title="Visa detaljer"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        {invoice.status === InvoiceStatus.DRAFT && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setConfirmSendInvoice(invoice)
                            }}
                            className="inline-flex items-center px-3 py-1 text-sm bg-primary-600 text-white rounded hover:bg-primary-700"
                            title={selectedCompany?.accounting_basis === 'accrual' ? 'Skicka och bokför faktura' : 'Skicka faktura'}
                          >
                            Skicka
                          </button>
                        )}
                        {invoice.status === InvoiceStatus.ISSUED && invoice.payment_status !== PaymentStatus.PAID && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setPaymentDate(new Date().toISOString().split('T')[0])
                              setPaymentAmount(invoice.total_amount - invoice.paid_amount)
                              setPaymentError(null)
                              setConfirmPayInvoice(invoice)
                            }}
                            className="p-1 text-primary-600 hover:text-primary-800"
                            title="Markera som betald"
                          >
                            <DollarSign className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            downloadInvoicePdf(invoice.id, String(invoice.invoice_number))
                          }}
                          className="inline-flex items-center px-3 py-1 text-sm bg-primary-600 text-white rounded hover:bg-primary-700"
                          title="Ladda ner PDF"
                        >
                          <Download className="w-4 h-4 mr-1" />
                          PDF
                        </button>
                      </div>
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Supplier Invoices */}
      <div>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold">Leverantörsfakturor (Inkommande)</h2>
          <button
            onClick={() => setShowCreateSupplierInvoiceModal(true)}
            className="btn btn-primary inline-flex items-center"
          >
            <Plus className="w-4 h-4 mr-2" />
            Registrera faktura
          </button>
        </div>

        <div className="flex gap-2 mb-4 flex-wrap">
          {filterButtons.map((f) => (
            <button
              key={f.key}
              onClick={() => setSupplierInvoiceFilter(f.key)}
              className={`px-3 py-1 text-sm rounded-full transition-colors ${
                supplierInvoiceFilter === f.key
                  ? 'bg-primary-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {supplierInvoices.length === 0 ? (
          <div className="card">
            <p className="text-gray-600">Inga leverantörsfakturor ännu.</p>
          </div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead>
                <tr>
                  <SortableHeader label="Fakturanr" sortKey="supplier_invoice_number" sortConfig={supplierInvoiceSortConfig} onSort={requestSupplierInvoiceSort} />
                  <SortableHeader label="Datum" sortKey="invoice_date" sortConfig={supplierInvoiceSortConfig} onSort={requestSupplierInvoiceSort} />
                  <SortableHeader label="Leverantör" sortKey="supplier_name" sortConfig={supplierInvoiceSortConfig} onSort={requestSupplierInvoiceSort} />
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Status
                  </th>
                  <SortableHeader label="Belopp" sortKey="total_amount" sortConfig={supplierInvoiceSortConfig} onSort={requestSupplierInvoiceSort} align="right" />
                  <SortableHeader label="Betalt" sortKey="paid_amount" sortConfig={supplierInvoiceSortConfig} onSort={requestSupplierInvoiceSort} align="right" />
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                    Åtgärder
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredSupplierInvoices.map((invoice) => {
                  const overdue = isInvoiceOverdue(invoice.status, invoice.payment_status, invoice.due_date)
                  return (
                  <tr
                    key={invoice.id}
                    onClick={() => navigate(`/supplier-invoices/${invoice.id}`)}
                    className={`cursor-pointer ${overdue ? 'bg-red-50 hover:bg-red-100' : 'hover:bg-gray-50'}`}
                  >
                    <td className="px-4 py-3 text-sm font-medium">
                      {invoice.supplier_invoice_number}
                    </td>
                    <td className="px-4 py-3 text-sm">{invoice.invoice_date}</td>
                    <td className="px-4 py-3 text-sm">{invoice.supplier_name}</td>
                    <td className="px-4 py-3 text-sm">{getStatusBadge(invoice.status, invoice.payment_status, invoice.due_date)}</td>
                    <td className="px-4 py-3 text-sm text-right font-mono">
                      {invoice.total_amount.toLocaleString('sv-SE', {
                        style: 'currency',
                        currency: 'SEK',
                      })}
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-mono">
                      {invoice.paid_amount.toLocaleString('sv-SE', {
                        style: 'currency',
                        currency: 'SEK',
                      })}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => navigate(`/supplier-invoices/${invoice.id}`)}
                          className="p-1 text-gray-600 hover:text-gray-800"
                          title="Visa detaljer"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        {invoice.status === InvoiceStatus.DRAFT && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setConfirmRegisterSupplierInvoice(invoice)
                            }}
                            className="inline-flex items-center px-3 py-1 text-sm bg-primary-600 text-white rounded hover:bg-primary-700"
                            title={selectedCompany?.accounting_basis === 'accrual' ? 'Bokför faktura' : 'Registrera faktura'}
                          >
                            {selectedCompany?.accounting_basis === 'accrual' ? 'Bokför' : 'Registrera'}
                          </button>
                        )}
                        {invoice.status === InvoiceStatus.ISSUED && invoice.payment_status !== PaymentStatus.PAID && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              setPaymentDate(new Date().toISOString().split('T')[0])
                              setPaymentAmount(invoice.total_amount - invoice.paid_amount)
                              setPaymentError(null)
                              setConfirmPaySupplierInvoice(invoice)
                            }}
                            className="p-1 text-primary-600 hover:text-primary-800"
                            title="Markera som betald"
                          >
                            <DollarSign className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create Invoice Modal */}
      {showCreateInvoiceModal && selectedCompany && (
        <DraggableModal
          modalType={ModalType.INVOICE}
          title="Ny kundfaktura"
          defaultWidth={900}
          defaultHeight={Math.min(window.innerHeight * 0.9, 700)}
          minWidth={600}
          minHeight={400}
          onClose={() => setShowCreateInvoiceModal(false)}
        >
          <InvoiceForm
            companyId={selectedCompany.id}
            customers={customers}
            accounts={accounts}
            initialData={invoiceInitialData}
            onSuccess={() => {
              setShowCreateInvoiceModal(false)
              setInvoiceInitialData(undefined)
              loadInvoices()
            }}
            onCancel={() => {
              setShowCreateInvoiceModal(false)
              setInvoiceInitialData(undefined)
            }}
          />
        </DraggableModal>
      )}

      {/* Create Supplier Invoice Modal */}
      {showCreateSupplierInvoiceModal && selectedCompany && (
        <DraggableModal
          modalType={ModalType.SUPPLIER_INVOICE}
          title="Registrera leverantörsfaktura"
          defaultWidth={900}
          defaultHeight={Math.min(window.innerHeight * 0.9, 700)}
          minWidth={600}
          minHeight={400}
          onClose={() => {
            resetSupplierInvoicePreview()
            setSupplierInvoiceAttachments([])
            setShowCreateSupplierInvoiceModal(false)
          }}
          rightPanel={supplierInvoicePinnedPreview}
          canPin={supplierInvoiceCanPin}
          isPinned={supplierInvoiceIsPinned}
          onTogglePinned={supplierInvoiceTogglePinned}
        >
          <SupplierInvoiceForm
            companyId={selectedCompany.id}
            suppliers={suppliers}
            accounts={accounts}
            initialData={supplierInvoiceInitialData}
            onSuccess={() => {
              resetSupplierInvoicePreview()
              setSupplierInvoiceAttachments([])
              setShowCreateSupplierInvoiceModal(false)
              setSupplierInvoiceInitialData(undefined)
              loadInvoices()
            }}
            onCancel={() => {
              resetSupplierInvoicePreview()
              setSupplierInvoiceAttachments([])
              setShowCreateSupplierInvoiceModal(false)
              setSupplierInvoiceInitialData(undefined)
            }}
            onAttachmentsChange={setSupplierInvoiceAttachments}
            onAttachmentClick={(_, index) => openSupplierInvoicePreview(index)}
          />
        </DraggableModal>
      )}

      {/* Floating attachment preview for supplier invoice (outside modal) */}
      {supplierInvoiceFloatingPreview}

      {/* Send Invoice Confirmation Modal */}
      {confirmSendInvoice && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 overflow-hidden">
            {/* Header */}
            <div className="bg-primary-50 px-6 py-4 border-b border-primary-100">
              <div className="flex items-center gap-3">
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center">
                  <Send className="w-5 h-5 text-primary-600" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">
                    Skicka faktura
                  </h3>
                  <p className="text-sm text-gray-600">
                    {confirmSendInvoice.invoice_number} - {confirmSendInvoice.customer_name}
                  </p>
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="px-6 py-4">
              <p className="text-gray-700">
                Vill du skicka denna faktura?
              </p>
              <p className="text-sm text-gray-500 mt-2">
                {selectedCompany?.accounting_basis === 'accrual'
                  ? 'En verifikation kommer att skapas automatiskt och fakturan markeras som skickad.'
                  : 'Fakturan markeras som skickad.'}
              </p>
              <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Belopp:</span>
                  <span className="font-semibold">
                    {confirmSendInvoice.total_amount.toLocaleString('sv-SE', { style: 'currency', currency: 'SEK' })}
                  </span>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="bg-gray-50 px-6 py-4 flex gap-3 justify-end">
              <button
                onClick={() => setConfirmSendInvoice(null)}
                disabled={sendingInvoice}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Avbryt
              </button>
              <button
                onClick={handleSendInvoice}
                disabled={sendingInvoice}
                className="px-4 py-2 text-sm font-medium text-white bg-primary-600 border border-transparent rounded-lg hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {sendingInvoice ? (
                  <>
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span>Skickar...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-4 h-4" />
                    <span>Skicka faktura</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Register Supplier Invoice Confirmation Modal */}
      {confirmRegisterSupplierInvoice && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 overflow-hidden">
            {/* Header */}
            <div className="bg-primary-50 px-6 py-4 border-b border-primary-100">
              <div className="flex items-center gap-3">
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center">
                  <FileText className="w-5 h-5 text-primary-600" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">
                    {selectedCompany?.accounting_basis === 'accrual' ? 'Bokför leverantörsfaktura' : 'Registrera leverantörsfaktura'}
                  </h3>
                  <p className="text-sm text-gray-600">
                    {confirmRegisterSupplierInvoice.supplier_invoice_number} - {confirmRegisterSupplierInvoice.supplier_name}
                  </p>
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="px-6 py-4">
              <p className="text-gray-700">
                {selectedCompany?.accounting_basis === 'accrual'
                  ? 'Vill du bokföra denna leverantörsfaktura?'
                  : 'Vill du registrera denna leverantörsfaktura?'}
              </p>
              <p className="text-sm text-gray-500 mt-2">
                {selectedCompany?.accounting_basis === 'accrual'
                  ? 'En verifikation kommer att skapas automatiskt med kostnad och ingående moms.'
                  : 'Fakturan registreras som mottagen. Bokföring sker när fakturan markeras som betald.'}
              </p>
              <div className="mt-4 p-3 bg-gray-50 rounded-lg">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Belopp:</span>
                  <span className="font-semibold">
                    {confirmRegisterSupplierInvoice.total_amount.toLocaleString('sv-SE', { style: 'currency', currency: 'SEK' })}
                  </span>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="bg-gray-50 px-6 py-4 flex gap-3 justify-end">
              <button
                onClick={() => setConfirmRegisterSupplierInvoice(null)}
                disabled={registeringSupplierInvoice}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Avbryt
              </button>
              <button
                onClick={handleRegisterSupplierInvoice}
                disabled={registeringSupplierInvoice}
                className="px-4 py-2 text-sm font-medium text-white bg-primary-600 border border-transparent rounded-lg hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {registeringSupplierInvoice ? (
                  <>
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span>{selectedCompany?.accounting_basis === 'accrual' ? 'Bokför...' : 'Registrerar...'}</span>
                  </>
                ) : (
                  <>
                    <FileText className="w-4 h-4" />
                    <span>{selectedCompany?.accounting_basis === 'accrual' ? 'Bokför faktura' : 'Registrera faktura'}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pay Invoice Confirmation Modal */}
      {confirmPayInvoice && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 overflow-hidden">
            {/* Header */}
            <div className="bg-primary-50 px-6 py-4 border-b border-primary-100">
              <div className="flex items-center gap-3">
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center">
                  <DollarSign className="w-5 h-5 text-primary-600" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">
                    Markera faktura som betald
                  </h3>
                  <p className="text-sm text-gray-600">
                    {confirmPayInvoice.invoice_number} - {confirmPayInvoice.customer_name}
                  </p>
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="px-6 py-4">
              <p className="text-gray-700 mb-4">
                En betalningsverifikation kommer att skapas automatiskt.
              </p>

              {paymentError && (
                <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg text-sm">
                  {paymentError}
                </div>
              )}

              {/* Invoice summary */}
              <div className="p-3 bg-gray-50 rounded-lg mb-4">
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-600">Fakturabelopp:</span>
                  <span className="font-semibold">
                    {confirmPayInvoice.total_amount.toLocaleString('sv-SE', { style: 'currency', currency: 'SEK' })}
                  </span>
                </div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-600">Redan betalt:</span>
                  <span>
                    {confirmPayInvoice.paid_amount.toLocaleString('sv-SE', { style: 'currency', currency: 'SEK' })}
                  </span>
                </div>
                <div className="flex justify-between text-sm font-semibold border-t pt-1 mt-1">
                  <span className="text-gray-700">Återstår:</span>
                  <span className="text-primary-600">
                    {(confirmPayInvoice.total_amount - confirmPayInvoice.paid_amount).toLocaleString('sv-SE', { style: 'currency', currency: 'SEK' })}
                  </span>
                </div>
              </div>

              {/* Payment date */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Betalningsdatum
                </label>
                <input
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
              </div>

              {/* Payment amount */}
              <div className="mb-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Belopp att registrera
                </label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={formatNumberWithSeparator(paymentAmount)}
                    onChange={(e) => {
                      setPaymentAmount(parseFormattedNumber(e.target.value))
                      setPaymentError(null)
                    }}
                    className="w-full px-3 py-2 pr-12 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">SEK</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Ändra beloppet för att registrera en delbetalning
                </p>
              </div>
            </div>

            {/* Actions */}
            <div className="bg-gray-50 px-6 py-4 flex gap-3 justify-end">
              <button
                onClick={() => setConfirmPayInvoice(null)}
                disabled={payingInvoice}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Avbryt
              </button>
              <button
                onClick={handlePayInvoice}
                disabled={payingInvoice}
                className="px-4 py-2 text-sm font-medium text-white bg-primary-600 border border-transparent rounded-lg hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {payingInvoice ? (
                  <>
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span>Sparar...</span>
                  </>
                ) : (
                  <>
                    <DollarSign className="w-4 h-4" />
                    <span>Markera som betald</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pay Supplier Invoice Confirmation Modal */}
      {confirmPaySupplierInvoice && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 overflow-hidden">
            {/* Header */}
            <div className="bg-primary-50 px-6 py-4 border-b border-primary-100">
              <div className="flex items-center gap-3">
                <div className="flex-shrink-0 w-10 h-10 rounded-full bg-primary-100 flex items-center justify-center">
                  <DollarSign className="w-5 h-5 text-primary-600" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">
                    Markera leverantörsfaktura som betald
                  </h3>
                  <p className="text-sm text-gray-600">
                    {confirmPaySupplierInvoice.supplier_invoice_number} - {confirmPaySupplierInvoice.supplier_name}
                  </p>
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="px-6 py-4">
              <p className="text-gray-700 mb-4">
                En betalningsverifikation kommer att skapas automatiskt.
              </p>

              {paymentError && (
                <div className="mb-4 p-3 bg-red-100 text-red-700 rounded-lg text-sm">
                  {paymentError}
                </div>
              )}

              {/* Invoice summary */}
              <div className="p-3 bg-gray-50 rounded-lg mb-4">
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-600">Fakturabelopp:</span>
                  <span className="font-semibold">
                    {confirmPaySupplierInvoice.total_amount.toLocaleString('sv-SE', { style: 'currency', currency: 'SEK' })}
                  </span>
                </div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-600">Redan betalt:</span>
                  <span>
                    {confirmPaySupplierInvoice.paid_amount.toLocaleString('sv-SE', { style: 'currency', currency: 'SEK' })}
                  </span>
                </div>
                <div className="flex justify-between text-sm font-semibold border-t pt-1 mt-1">
                  <span className="text-gray-700">Återstår:</span>
                  <span className="text-primary-600">
                    {(confirmPaySupplierInvoice.total_amount - confirmPaySupplierInvoice.paid_amount).toLocaleString('sv-SE', { style: 'currency', currency: 'SEK' })}
                  </span>
                </div>
              </div>

              {/* Payment date */}
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Betalningsdatum
                </label>
                <input
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                />
              </div>

              {/* Payment amount */}
              <div className="mb-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Belopp att registrera
                </label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={formatNumberWithSeparator(paymentAmount)}
                    onChange={(e) => {
                      setPaymentAmount(parseFormattedNumber(e.target.value))
                      setPaymentError(null)
                    }}
                    className="w-full px-3 py-2 pr-12 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">SEK</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Ändra beloppet för att registrera en delbetalning
                </p>
              </div>
            </div>

            {/* Actions */}
            <div className="bg-gray-50 px-6 py-4 flex gap-3 justify-end">
              <button
                onClick={() => setConfirmPaySupplierInvoice(null)}
                disabled={payingSupplierInvoice}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Avbryt
              </button>
              <button
                onClick={handlePaySupplierInvoice}
                disabled={payingSupplierInvoice}
                className="px-4 py-2 text-sm font-medium text-white bg-primary-600 border border-transparent rounded-lg hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {payingSupplierInvoice ? (
                  <>
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span>Sparar...</span>
                  </>
                ) : (
                  <>
                    <DollarSign className="w-4 h-4" />
                    <span>Markera som betald</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
