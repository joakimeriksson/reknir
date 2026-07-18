import { useState, useEffect } from 'react'
import { AlertCircle, CheckCircle, FileText, Trash2 } from 'lucide-react'
import type { Account, Verification, PostingTemplate, TransactionLine, EntityAttachment } from '@/types'
import { verificationApi, postingTemplateApi, attachmentApi } from '@/services/api'
import { getErrorMessage } from '@/utils/errors'
import AttachmentManager from '@/components/AttachmentManager'
import AccountCombobox from '@/components/forms/AccountCombobox'

// Stable empty array to avoid creating new references on each render
const EMPTY_ATTACHMENTS: EntityAttachment[] = []

// ============================================================================
// Types & Interfaces
// ============================================================================

export interface VerificationInitialData {
  description?: string
  transaction_date?: string
  series?: string
  lines?: Partial<TransactionLine>[]
  pendingAttachmentIds?: number[]
}

export interface VerificationFormProps {
  companyId: number
  fiscalYearId: number
  accounts: Account[]
  verification?: Verification | null  // null = create new
  initialData?: VerificationInitialData
  onSuccess: () => void
  onCancel: () => void
  // Render props for footer buttons (allows parent to control button placement)
  renderFooter?: (props: {
    onSubmit: () => void
    onCancel: () => void
    isLoading: boolean
    isValid: boolean
    isEditing: boolean
  }) => React.ReactNode
  // Callback for parent to track attachment changes (for split-screen feature)
  onAttachmentsChange?: (attachments: EntityAttachment[]) => void
  // Callback when attachment is clicked (for external preview handling)
  onAttachmentClick?: (attachment: EntityAttachment, index: number) => void
  // Pending attachment IDs (lifted to parent to survive modal layout changes)
  pendingAttachmentIds?: number[]
  onPendingAttachmentIdsChange?: React.Dispatch<React.SetStateAction<number[]>>
}

// ============================================================================
// Main Component
// ============================================================================

export default function VerificationForm({
  companyId,
  fiscalYearId,
  accounts,
  verification,
  initialData,
  onSuccess,
  onCancel,
  renderFooter,
  onAttachmentsChange,
  onAttachmentClick,
  pendingAttachmentIds: pendingAttachmentIdsProp,
  onPendingAttachmentIdsChange,
}: VerificationFormProps) {
  const isEditing = !!verification

  const [formData, setFormData] = useState({
    series: verification?.series || initialData?.series || 'A',
    transaction_date: verification?.transaction_date || initialData?.transaction_date || new Date().toISOString().split('T')[0],
    description: verification?.description || initialData?.description || '',
  })

  const [lines, setLines] = useState<TransactionLine[]>(
    verification?.transaction_lines
      || (initialData?.lines?.length
        ? initialData.lines.map(l => ({
            account_id: l.account_id || 0,
            debit: l.debit || 0,
            credit: l.credit || 0,
            description: l.description || '',
          }))
        : [
            { account_id: 0, debit: 0, credit: 0, description: '' },
            { account_id: 0, debit: 0, credit: 0, description: '' },
          ])
  )

  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)
  const [templates, setTemplates] = useState<PostingTemplate[]>([])
  const [templatesLoading, setTemplatesLoading] = useState(false)

  // Support both controlled (props) and uncontrolled (internal state) modes
  const [internalPendingIds, setInternalPendingIds] = useState<number[]>([])
  const pendingAttachmentIds = pendingAttachmentIdsProp ?? internalPendingIds
  const setPendingAttachmentIds = onPendingAttachmentIdsChange ?? setInternalPendingIds

  // Load templates when component mounts
  useEffect(() => {
    if (!isEditing) {
      loadTemplates()
    }
  }, [isEditing])

  const loadTemplates = async () => {
    try {
      setTemplatesLoading(true)
      const response = await postingTemplateApi.list(companyId)
      setTemplates(response.data)
    } catch (error) {
      console.error('Failed to load templates:', error)
    } finally {
      setTemplatesLoading(false)
    }
  }

  // Apply template using the API
  const applyTemplate = async (templateId: number, amount: number) => {
    try {
      setLoading(true)
      const executionResult = await postingTemplateApi.execute(templateId, {
        amount,
        fiscal_year_id: fiscalYearId
      })
      const result = executionResult.data

      setFormData({
        ...formData,
        description: result.template_name
      })

      const newLines = result.posting_lines.map((line) => ({
        account_id: line.account_id,
        debit: line.debit,
        credit: line.credit,
        description: line.description || '',
      }))

      setLines(newLines)
      setShowTemplates(false)
    } catch (error: any) {
      console.error('Failed to execute template:', error)
      setError(error.response?.data?.detail || 'Kunde inte tillämpa mall')
    } finally {
      setLoading(false)
    }
  }

  const addLine = () => {
    setLines([...lines, { account_id: 0, debit: 0, credit: 0, description: '' }])
  }

  const removeLine = (index: number) => {
    if (lines.length <= 2) return
    setLines(lines.filter((_, i) => i !== index))
  }

  const updateLine = (index: number, field: string, value: string | number) => {
    const newLines = [...lines]
    newLines[index] = { ...newLines[index], [field]: value }
    setLines(newLines)
  }

  const totalDebit = lines.reduce((sum, line) => sum + (Number(line.debit) || 0), 0)
  const totalCredit = lines.reduce((sum, line) => sum + (Number(line.credit) || 0), 0)
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01

  const handleSubmit = async () => {
    setError(null)
    setLoading(true)

    if (!isBalanced) {
      setError('Verifikationen är inte i balans! Debet måste vara lika med kredit.')
      setLoading(false)
      return
    }

    try {
      const data = {
        company_id: companyId,
        fiscal_year_id: fiscalYearId,
        ...formData,
        transaction_lines: lines.map((line) => ({
          account_id: Number(line.account_id),
          debit: Number(line.debit) || 0,
          credit: Number(line.credit) || 0,
          description: line.description || undefined,
        })),
      }

      if (isEditing) {
        await verificationApi.update(verification.id!, {
          description: formData.description,
          transaction_date: formData.transaction_date,
        })
      } else {
        const response = await verificationApi.create(data)
        const newVerificationId = response.data.id!

        // Link pending attachments to the new verification
        for (const attachmentId of pendingAttachmentIds) {
          await verificationApi.linkAttachment(newVerificationId, attachmentId)
        }
      }

      onSuccess()
    } catch (err) {
      setError(getErrorMessage(err, 'Ett fel uppstod'))
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto space-y-6">
        {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded flex items-center">
          <AlertCircle className="w-5 h-5 mr-2" />
          {error}
        </div>
      )}

      {/* Template Selection */}
      {!isEditing && accounts.length > 0 && (
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center">
              <FileText className="w-5 h-5 text-blue-600 mr-2" />
              <h3 className="font-medium text-blue-900">Mallar för vanliga transaktioner</h3>
            </div>
            <button
              type="button"
              onClick={() => setShowTemplates(!showTemplates)}
              className="text-sm text-blue-600 hover:text-blue-800"
            >
              {showTemplates ? 'Dölj mallar' : 'Visa mallar'}
            </button>
          </div>

          {showTemplates && (
            <div className="mt-3">
              {templatesLoading ? (
                <div className="text-center py-4">
                  <p className="text-sm text-gray-500">Laddar mallar...</p>
                </div>
              ) : templates.length === 0 ? (
                <div className="text-center py-4 bg-gray-50 rounded border">
                  <p className="text-sm text-gray-600">Inga mallar hittades</p>
                  <p className="text-xs text-gray-500 mt-1">Skapa mallar i administrationen för att använda dem här</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {templates.filter(t => t.id != null).map((template) => (
                    <div key={template.id} className="bg-white p-3 rounded border border-blue-200">
                      <h4 className="font-medium text-sm mb-1">{template.name}</h4>
                      <p className="text-xs text-gray-600 mb-2">{template.description}</p>
                      <p className="text-xs text-gray-500 mb-2">
                        {template.template_lines.length} rader {template.updated_at && `• Senast uppdaterad: ${new Date(template.updated_at).toLocaleDateString('sv-SE')}`}
                      </p>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          placeholder="Total"
                          className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded"
                          id={`template-amount-${template.id}`}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const amountInput = document.getElementById(
                              `template-amount-${template.id}`
                            ) as HTMLInputElement
                            const amount = Number(amountInput.value) || 1000
                            applyTemplate(template.id!, amount)
                          }}
                          className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                          disabled={loading}
                        >
                          {loading ? 'Tillämpar...' : 'Använd'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Form fields */}
      <div className="grid grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Serie *
          </label>
          <input
            type="text"
            required
            maxLength={10}
            value={formData.series}
            onChange={(e) => setFormData({ ...formData, series: e.target.value })}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            disabled={isEditing}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Datum *
          </label>
          <input
            type="date"
            required
            value={formData.transaction_date}
            onChange={(e) => setFormData({ ...formData, transaction_date: e.target.value })}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Beskrivning *
          </label>
          <input
            type="text"
            required
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            placeholder="t.ex. Inköp av material"
          />
        </div>
      </div>

      {/* Transaction lines */}
      <div>
        <div className="flex justify-between items-center mb-2">
          <h3 className="text-lg font-medium">Transaktionsrader</h3>
          <button
            type="button"
            onClick={addLine}
            className="text-sm text-primary-600 hover:text-primary-800"
            disabled={isEditing}
          >
            + Lägg till rad
          </button>
        </div>

        {accounts.length === 0 && (
          <div className="mb-4 p-4 bg-yellow-50 border border-yellow-200 rounded">
            <p className="text-yellow-800 text-sm">
              ⚠️ Inga konton hittades. Kontrollera att BAS-kontoplanen är importerad.
            </p>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="min-w-full border border-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 w-2/5">Konto *</th>
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 w-1/5">Beskrivning</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">Debet</th>
                <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">Kredit</th>
                {!isEditing && (
                  <th className="px-4 py-2 text-center text-xs font-medium text-gray-500">Åtgärd</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {lines.map((line, index) => {
                const accountExists = accounts.find(a => a.id === line.account_id)
                const lineHasAccount = line.account_number && line.account_name

                return (
                  <tr key={index}>
                    <td className="px-4 py-2">
                      {isEditing ? (
                        <select
                          value={line.account_id}
                          className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                          disabled
                        >
                          {!accountExists && lineHasAccount ? (
                            <option value={line.account_id}>⚠ {line.account_number} - {line.account_name}</option>
                          ) : (
                            <option value={line.account_id}>
                              {accountExists ? `${accountExists.account_number} - ${accountExists.name}` : 'Okänt konto'}
                            </option>
                          )}
                        </select>
                      ) : (
                        <AccountCombobox
                          accounts={accounts}
                          value={line.account_id}
                          onChange={(id) => updateLine(index, 'account_id', id)}
                        />
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="text"
                        value={line.description}
                        onChange={(e) => updateLine(index, 'description', e.target.value)}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                        placeholder="Radtext (valfritt)"
                        disabled={isEditing}
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        step="1"
                        min="0"
                        value={line.debit || ''}
                        onChange={(e) => updateLine(index, 'debit', e.target.value)}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm text-right"
                        disabled={isEditing}
                      />
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        step="1"
                        min="0"
                        value={line.credit || ''}
                        onChange={(e) => updateLine(index, 'credit', e.target.value)}
                        className="w-full px-2 py-1 border border-gray-300 rounded text-sm text-right"
                        disabled={isEditing}
                      />
                    </td>
                    {!isEditing && (
                      <td className="px-4 py-2 text-center">
                        <button
                          type="button"
                          onClick={() => removeLine(index)}
                          className="text-red-600 hover:text-red-800 disabled:opacity-50"
                          disabled={lines.length <= 2}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
            <tfoot className="bg-gray-50">
              <tr>
                <td colSpan={2} className="px-4 py-2 text-right font-medium">Totalt:</td>
                <td className="px-4 py-2 text-right font-mono font-bold">{totalDebit.toLocaleString('sv-SE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</td>
                <td className="px-4 py-2 text-right font-mono font-bold">{totalCredit.toLocaleString('sv-SE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</td>
                {!isEditing && <td></td>}
              </tr>
              <tr>
                <td colSpan={!isEditing ? 5 : 4} className="px-4 py-2 text-center">
                  {isBalanced ? (
                    <span className="inline-flex items-center text-green-600 font-medium">
                      <CheckCircle className="w-4 h-4 mr-2" />
                      I balans
                    </span>
                  ) : (
                    <span className="inline-flex items-center text-red-600 font-medium">
                      <AlertCircle className="w-4 h-4 mr-2" />
                      Ej i balans (skillnad: {Math.abs(totalDebit - totalCredit).toLocaleString('sv-SE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })})
                    </span>
                  )}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Attachments section - only show when creating new verification */}
      {!isEditing && (
        <AttachmentManager
          attachments={EMPTY_ATTACHMENTS}
          config={{
            allowUpload: true,
            allowDelete: true,
          }}
          labels={{
            title: 'Bilagor',
            emptyState: 'Inga bilagor valda',
            uploadButton: 'Ladda upp',
            addMoreButton: 'Lägg till fler',
            deleteConfirm: (filename) => `Ta bort ${filename}?`,
          }}
          onUpload={async (file) => {
            const response = await attachmentApi.upload(companyId, file)
            setPendingAttachmentIds(prev => [...prev, response.data.id])
          }}
          onDelete={async () => {}}
          onDownload={async (attachment) => {
            const response = await attachmentApi.download(attachment.attachment_id)
            const url = window.URL.createObjectURL(new Blob([response.data]))
            const link = document.createElement('a')
            link.href = url
            link.setAttribute('download', attachment.original_filename)
            document.body.appendChild(link)
            link.click()
            link.remove()
            window.URL.revokeObjectURL(url)
          }}
          companyId={companyId}
          pendingMode={true}
          pendingAttachmentIds={pendingAttachmentIds}
          onPendingSelectionChange={setPendingAttachmentIds}
          onAttachmentClick={onAttachmentClick}
          disableInternalPreview={!!onAttachmentClick}
          onVisibleAttachmentsChange={onAttachmentsChange}
        />
      )}
      </div>

      {/* Footer - either render prop or default */}
      {renderFooter ? (
        renderFooter({
          onSubmit: handleSubmit,
          onCancel,
          isLoading: loading,
          isValid: isBalanced,
          isEditing,
        })
      ) : (
        <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 bg-white">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
          >
            Avbryt
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={loading || !isBalanced || isEditing}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading
              ? 'Sparar...'
              : isEditing
              ? 'Kan inte redigera verifikationer'
              : 'Skapa verifikation'}
          </button>
        </div>
      )}
    </div>
  )
}
