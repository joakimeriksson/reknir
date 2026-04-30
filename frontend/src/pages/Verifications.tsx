import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Edit, Trash2, CheckCircle } from 'lucide-react'
import { verificationApi, accountApi, aiApi } from '@/services/api'
import type { VerificationListItem, Account, Verification, EntityAttachment } from '@/types'
import { useFiscalYear } from '@/contexts/FiscalYearContext'
import { useCompany } from '@/contexts/CompanyContext'
import { getErrorMessage } from '@/utils/errors'
import DraggableModal from '@/components/DraggableModal'
import { ModalType } from '@/contexts/LayoutSettingsContext'
import VerificationForm from '@/components/forms/VerificationForm'
import FiscalYearSelector from '@/components/FiscalYearSelector'
import { useAttachmentPreviewController } from '@/hooks/useAttachmentPreviewController'
import { useSortableTable } from '@/hooks/useSortableTable'
import SortableHeader from '@/components/SortableHeader'
import { useToast } from '@/contexts/ToastContext'
import { useAIForm } from '@/contexts/AIFormContext'
import type { VerificationInitialData } from '@/components/forms/VerificationForm'

export default function Verifications() {
  const navigate = useNavigate()
  const { showToast } = useToast()
  const { selectedCompany } = useCompany()
  const [verifications, setVerifications] = useState<VerificationListItem[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editingVerification, setEditingVerification] = useState<Verification | null>(null)
  const { selectedFiscalYear } = useFiscalYear()
  const { pendingForm, clearForm } = useAIForm()
  const [verificationInitialData, setVerificationInitialData] = useState<VerificationInitialData | undefined>()

  useEffect(() => {
    if (pendingForm?.type === 'verification') {
      const d = pendingForm.data
      const uploadIds = pendingForm.aiUploadIds || []
      clearForm()

      const open = async () => {
        const attachmentIds: number[] = []
        for (const uploadId of uploadIds) {
          try {
            const resp = await aiApi.copyToAttachment(uploadId)
            attachmentIds.push(resp.data.id)
          } catch { /* ignore */ }
        }
        setVerificationInitialData({
          description: d.description as string,
          transaction_date: d.transaction_date as string,
          series: d.series as string,
          lines: d.lines as Partial<import('@/types').TransactionLine>[],
          pendingAttachmentIds: attachmentIds.length > 0 ? attachmentIds : undefined,
        })
        setPendingAttachmentIds(attachmentIds)
        setShowCreateModal(true)
      }
      open()
    }
  }, [pendingForm, clearForm])

  // Search and filter state
  const [searchQuery, setSearchQuery] = useState('')
  const [seriesFilter, setSeriesFilter] = useState<string>('all')

  // Track attachments from form for preview controller
  const [formAttachments, setFormAttachments] = useState<EntityAttachment[]>([])

  // Pending attachment IDs (lifted from VerificationForm to survive modal layout changes)
  const [pendingAttachmentIds, setPendingAttachmentIds] = useState<number[]>([])

  // Attachment preview controller
  const {
    openPreview,
    reset: resetPreview,
    floatingPreview,
    pinnedPreview,
    canPin,
    isPinned,
    togglePinned,
  } = useAttachmentPreviewController(formAttachments, {
    modalType: ModalType.VERIFICATION,
  })

  const loadData = useCallback(async () => {
    if (!selectedCompany || !selectedFiscalYear) {
      setLoading(false)
      setVerifications([])
      return
    }

    try {
      setLoading(true)

      // Load verifications for selected fiscal year
      const verificationsRes = await verificationApi.list(selectedCompany.id, {
        fiscal_year_id: selectedFiscalYear.id,
        limit: 1000,
      })
      setVerifications(verificationsRes.data)

      // Load accounts for selected fiscal year
      const accountsRes = await accountApi.list(selectedCompany.id, selectedFiscalYear.id)
      setAccounts(accountsRes.data)
    } catch (error) {
      console.error('Failed to load verifications:', error)
    } finally {
      setLoading(false)
    }
  }, [selectedCompany, selectedFiscalYear])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Filter verifications
  const filteredVerifications = verifications.filter((v) => {
    const matchesSeries = seriesFilter === 'all' || v.series === seriesFilter
    // Normalize search: remove spaces for amount matching (4500 matches "4 500")
    const normalizedQuery = searchQuery.replace(/\s/g, '')
    const formattedAmount = v.total_amount.toLocaleString('sv-SE')
    const matchesSearch =
      searchQuery === '' ||
      v.verification_number.toString().includes(searchQuery) ||
      v.transaction_date.includes(searchQuery) ||
      v.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      formattedAmount.includes(searchQuery) ||
      formattedAmount.replace(/\s/g, '').includes(normalizedQuery)
    return matchesSeries && matchesSearch
  })

  // Get unique series for filter dropdown
  const uniqueSeries = [...new Set(verifications.map((v) => v.series))].sort()

  // Statistics
  const lockedCount = filteredVerifications.filter((v) => v.locked).length

  // Sorting
  const { sortedData: sortedVerifications, sortConfig, requestSort } = useSortableTable(
    filteredVerifications,
    { key: 'verification_number', direction: 'desc' }
  )

  const handleDelete = async (id: number) => {
    if (!confirm(
      'VARNING: Radering av verifikationer är endast tillåtet i utvecklingsläge!\n\n' +
      'I produktion ska du istället använda korrigerande verifikationer enligt god redovisningssed.\n\n' +
      'Är du säker på att du vill radera denna verifikation?'
    )) return

    try {
      await verificationApi.delete(id)
      await loadData()
    } catch (error) {
      console.error('Failed to delete verification:', error)
      showToast(getErrorMessage(error, 'Kunde inte radera verifikationen'), 'error')
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Laddar verifikationer...</p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <h1 className="text-3xl font-bold">Verifikationer</h1>
        <FiscalYearSelector />
      </div>

      {/* Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="card">
          <h3 className="text-sm font-medium text-gray-500 mb-1">Antal verifikationer</h3>
          <p className="text-2xl font-bold">{filteredVerifications.length}</p>
        </div>
        <div className="card">
          <h3 className="text-sm font-medium text-gray-500 mb-1">Låsta</h3>
          <p className="text-2xl font-bold">{lockedCount}</p>
        </div>
        <div className="card">
          <h3 className="text-sm font-medium text-gray-500 mb-1">Olåsta</h3>
          <p className="text-2xl font-bold">{filteredVerifications.length - lockedCount}</p>
        </div>
      </div>

      <div className="flex justify-end mb-4">
        <button
          onClick={() => setShowCreateModal(true)}
          className="btn btn-primary inline-flex items-center"
        >
          <Plus className="w-4 h-4 mr-2" />
          Ny verifikation
        </button>
      </div>

      {/* Filters */}
      <div className="card mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Sök</label>
            <input
              type="text"
              placeholder="Ver.nr, datum, beskrivning eller belopp..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Serie</label>
            <select
              value={seriesFilter}
              onChange={(e) => setSeriesFilter(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            >
              <option value="all">Alla serier ({verifications.length})</option>
              {uniqueSeries.map((series) => {
                const count = verifications.filter((v) => v.series === series).length
                return (
                  <option key={series} value={series}>
                    {series} ({count})
                  </option>
                )
              })}
            </select>
          </div>
        </div>
      </div>

      {filteredVerifications.length === 0 ? (
        <div className="card">
          <p className="text-gray-600">
            {verifications.length === 0
              ? 'Inga verifikationer ännu. Skapa din första verifikation för att registrera transaktioner!'
              : 'Inga verifikationer matchar din sökning.'}
          </p>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead>
              <tr>
                <SortableHeader label="Ver.nr" sortKey="verification_number" sortConfig={sortConfig} onSort={requestSort} />
                <SortableHeader label="Datum" sortKey="transaction_date" sortConfig={sortConfig} onSort={requestSort} />
                <SortableHeader label="Beskrivning" sortKey="description" sortConfig={sortConfig} onSort={requestSort} />
                <SortableHeader label="Belopp" sortKey="total_amount" sortConfig={sortConfig} onSort={requestSort} align="right" />
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                  Underlag
                </th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">
                  Åtgärder
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {sortedVerifications.map((verification) => (
                <tr
                  key={verification.id}
                  className="hover:bg-gray-50 cursor-pointer"
                  onClick={() => navigate(`/verifications/${verification.id}`)}
                >
                  <td className="px-4 py-3 text-sm font-medium">
                    {verification.series}{verification.verification_number}
                  </td>
                  <td className="px-4 py-3 text-sm">{verification.transaction_date}</td>
                  <td className="px-4 py-3 text-sm max-w-md truncate">
                    {verification.description}
                  </td>
                  <td className="px-4 py-3 text-sm text-right font-mono">
                    {verification.total_amount.toLocaleString('sv-SE', {
                      style: 'currency',
                      currency: 'SEK',
                    })}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {verification.attachment_count > 0 && (
                      <span className="inline-flex items-center text-green-600" title={`${verification.attachment_count} underlag`}>
                        <CheckCircle className="w-4 h-4" />
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-2">
                      {!verification.locked && (
                        <>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              // Load full verification and edit
                              verificationApi.get(verification.id).then((res) => {
                                setEditingVerification(res.data)
                                setShowCreateModal(true)
                              })
                            }}
                            className="p-1 text-blue-600 hover:text-blue-800"
                            title="Redigera"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDelete(verification.id)
                            }}
                            className="p-1 text-red-600 hover:text-red-800"
                            title="Radera"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Create/Edit Modal */}
      {showCreateModal && selectedCompany && selectedFiscalYear && (
        <DraggableModal
          modalType={ModalType.VERIFICATION}
          title={editingVerification ? 'Redigera verifikation' : 'Ny verifikation'}
          defaultWidth={1024}
          defaultHeight={Math.min(window.innerHeight * 0.9, 800)}
          minWidth={600}
          minHeight={400}
          onClose={() => {
            resetPreview()
            setFormAttachments([])
            setPendingAttachmentIds([])
            setShowCreateModal(false)
            setEditingVerification(null)
          }}
          rightPanel={pinnedPreview}
          canPin={canPin}
          isPinned={isPinned}
          onTogglePinned={togglePinned}
        >
          <VerificationForm
            companyId={selectedCompany.id}
            fiscalYearId={selectedFiscalYear.id}
            accounts={accounts}
            verification={editingVerification}
            initialData={verificationInitialData}
            onSuccess={() => {
              resetPreview()
              setFormAttachments([])
              setPendingAttachmentIds([])
              setShowCreateModal(false)
              const wasEditing = !!editingVerification
              setEditingVerification(null)
              setVerificationInitialData(undefined)
              loadData()
              showToast(wasEditing ? 'Verifikation uppdaterad' : 'Verifikation skapad', 'success')
            }}
            onCancel={() => {
              resetPreview()
              setFormAttachments([])
              setPendingAttachmentIds([])
              setShowCreateModal(false)
              setEditingVerification(null)
              setVerificationInitialData(undefined)
            }}
            onAttachmentsChange={setFormAttachments}
            onAttachmentClick={(_, index) => openPreview(index)}
            pendingAttachmentIds={pendingAttachmentIds}
            onPendingAttachmentIdsChange={setPendingAttachmentIds}
          />
        </DraggableModal>
      )}

      {/* Floating attachment preview (outside modal) */}
      {floatingPreview}
    </div>
  )
}
