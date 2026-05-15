import { useState, useEffect, useMemo } from 'react'
import { companyApi, sie4Api, accountApi, fiscalYearApi, postingTemplateApi, backupApi, attachmentApi, aiApi } from '@/services/api'
import type { Account, FiscalYear, PostingTemplate, PostingTemplateLine, BackupInfo, BackupScheduleResponse, Attachment, AISettings, OllamaModel, OllamaHealth } from '@/types'
import { VATReportingPeriod, AccountingBasis, PaymentType, AttachmentRole } from '@/types'
import { Plus, Trash2, GripVertical, Building2, Edit2, Save, X, Calendar, Upload, Image, Layout, Download, HardDrive, RotateCcw, Loader2, CreditCard, Paperclip, Clock, Bot } from 'lucide-react'
import RestoreModal from '@/components/RestoreModal'
import SIE4ImportModal from '@/components/SIE4ImportModal'
import { useAuth } from '@/contexts/AuthContext'
import { useCompany } from '@/contexts/CompanyContext'
import { useFiscalYear } from '@/contexts/FiscalYearContext'
import { useLayoutSettings, ModalType } from '@/contexts/LayoutSettingsContext'
import { useAttachmentPreviewController } from '@/hooks/useAttachmentPreviewController'
import FiscalYearSelector from '@/components/FiscalYearSelector'
import { useToast } from '@/contexts/ToastContext'

export default function SettingsPage() {
  const { user } = useAuth()
  const { selectedCompany, setSelectedCompany, companies, loadCompanies } = useCompany()
  const { showToast } = useToast()
  const { selectedFiscalYear } = useFiscalYear()
  const { settings: layoutSettings, updateSettings: updateLayoutSettings } = useLayoutSettings()
  const [allAccounts, setAllAccounts] = useState<Account[]>([])
  const [fiscalYears, setFiscalYears] = useState<FiscalYear[]>([])
  const [accountCountsByFiscalYear, setAccountCountsByFiscalYear] = useState<Record<number, number>>({})
  const [templates, setTemplates] = useState<PostingTemplate[]>([])
  const [showCreateTemplate, setShowCreateTemplate] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<PostingTemplate | null>(null)
  const [templateForm, setTemplateForm] = useState<PostingTemplate>({
    company_id: 0,
    name: '',
    description: '',
    default_series: '',
    default_journal_text: '',
    template_lines: []
  })
  const [loading, setLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<'company' | 'fiscal' | 'templates' | 'import' | 'layout' | 'ai'>('company')
  const [showCreateFiscalYear, setShowCreateFiscalYear] = useState(false)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [logoUrl, setLogoUrl] = useState<string | null>(null)
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const [loadingBackups, setLoadingBackups] = useState(false)
  const [creatingBackup, setCreatingBackup] = useState(false)
  const [downloadingBackup, setDownloadingBackup] = useState<string | null>(null)
  const [showRestoreModal, setShowRestoreModal] = useState(false)
  const [showSIE4ImportModal, setShowSIE4ImportModal] = useState(false)
  const [schedule, setSchedule] = useState<BackupScheduleResponse | null>(null)
  const [scheduleForm, setScheduleForm] = useState({ enabled: false, interval_hours: 24, max_backups: 30, preferred_time: '03:00' })
  const [savingSchedule, setSavingSchedule] = useState(false)
  const [deletingBackup, setDeletingBackup] = useState<string | null>(null)
  const [backupToDelete, setBackupToDelete] = useState<string | null>(null)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [loadingAttachments, setLoadingAttachments] = useState(false)
  const [deletingAttachment, setDeletingAttachment] = useState<number | null>(null)
  const [editingPaymentInfo, setEditingPaymentInfo] = useState(false)
  const [paymentForm, setPaymentForm] = useState({
    payment_type: '' as PaymentType | '',
    bankgiro_number: '',
    plusgiro_number: '',
    clearing_number: '',
    account_number: '',
    iban: '',
    bic: '',
  })
  const [editingCompany, setEditingCompany] = useState(false)
  const [showCreateCompany, setShowCreateCompany] = useState(false)
  // AI settings state
  const [, setAiSettings] = useState<AISettings | null>(null)
  const [aiModels, setAiModels] = useState<OllamaModel[]>([])
  const [aiHealth, setAiHealth] = useState<OllamaHealth | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiSaving, setAiSaving] = useState(false)
  const [aiTesting, setAiTesting] = useState(false)
  const [aiForm, setAiForm] = useState({ ai_enabled: false, ollama_url: '', ollama_model: '', system_prompt: '' })
  const [companyForm, setCompanyForm] = useState({
    name: '',
    org_number: '',
    address: '',
    postal_code: '',
    city: '',
    phone: '',
    email: '',
    fiscal_year_start: new Date().getFullYear() + '-01-01',
    fiscal_year_end: new Date().getFullYear() + '-12-31',
    vat_number: '',
    accounting_basis: AccountingBasis.ACCRUAL,
    vat_reporting_period: VATReportingPeriod.QUARTERLY,
    is_vat_registered: true,
  })

  const getNextFiscalYearDefaults = () => {
    const currentYear = new Date().getFullYear()
    const nextYear = fiscalYears.length > 0
      ? Math.max(...fiscalYears.map(fy => fy.year)) + 1
      : currentYear

    return {
      year: nextYear,
      label: `${nextYear}`,
      start_date: `${nextYear}-01-01`,
      end_date: `${nextYear}-12-31`,
    }
  }

  const [newFiscalYear, setNewFiscalYear] = useState(getNextFiscalYearDefaults())

  useEffect(() => {
    loadData()
  }, [selectedCompany, selectedFiscalYear])

  useEffect(() => {
    if (activeTab === 'import') {
      loadBackups()
      loadSchedule()
    }
  }, [activeTab])

  useEffect(() => {
    if (activeTab === 'layout' && selectedCompany) {
      loadAttachments()
    }
  }, [activeTab, selectedCompany])

  // Load company logo as blob URL (img tags can't send auth headers)
  useEffect(() => {
    if (!selectedCompany?.logo_filename) {
      setLogoUrl(null)
      return
    }

    let objectUrl: string | null = null
    companyApi.getLogo(selectedCompany.id)
      .then((res) => {
        objectUrl = URL.createObjectURL(res.data)
        setLogoUrl(objectUrl)
      })
      .catch(() => {
        setLogoUrl(null)
      })

    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [selectedCompany?.id, selectedCompany?.logo_filename])

  const loadAiSettings = async () => {
    setAiLoading(true)
    try {
      const settingsResp = await aiApi.getSettings()
      setAiSettings(settingsResp.data)
      setAiForm({
        ai_enabled: settingsResp.data.ai_enabled,
        ollama_url: settingsResp.data.ollama_url,
        ollama_model: settingsResp.data.ollama_model,
        system_prompt: settingsResp.data.system_prompt || '',
      })
      // Only load models list (no health test)
      try {
        const modelsResp = await aiApi.listModels()
        setAiModels(modelsResp.data)
      } catch {
        setAiModels([])
      }
    } catch {
      // AI may not be configured yet
    } finally {
      setAiLoading(false)
    }
  }

  const testAiConnection = async () => {
    setAiTesting(true)
    setAiHealth(null)
    try {
      // Save current form first so the test uses the right URL/model
      await aiApi.updateSettings({
        ollama_url: aiForm.ollama_url,
        ollama_model: aiForm.ollama_model,
      })
      const healthResp = await aiApi.getHealth()
      setAiHealth(healthResp.data)
      // Refresh models list
      try {
        const modelsResp = await aiApi.listModels()
        setAiModels(modelsResp.data)
      } catch {
        // ignore
      }
    } catch {
      setAiHealth({ reachable: false, model_available: null, model_name: null, error: 'Kunde inte nå backend' })
    } finally {
      setAiTesting(false)
    }
  }

  const saveAiSettings = async () => {
    setAiSaving(true)
    try {
      const resp = await aiApi.updateSettings({
        ai_enabled: aiForm.ai_enabled,
        ollama_url: aiForm.ollama_url,
        ollama_model: aiForm.ollama_model,
        system_prompt: aiForm.system_prompt || null,
      })
      setAiSettings(resp.data)
      showToast('AI-inställningar sparade', 'success')
    } catch {
      showToast('Kunde inte spara AI-inställningar', 'error')
    } finally {
      setAiSaving(false)
    }
  }

  const loadData = async () => {
    if (!selectedCompany) {
      setLoading(false)
      return
    }

    try {
      setLoading(true)
      const fiscalYearsRes = await fiscalYearApi.list(selectedCompany.id).catch(() => ({ data: [] }))
      setFiscalYears(fiscalYearsRes.data)

      // Load account counts for each fiscal year (for the fiscal year tab)
      const accountCounts: Record<number, number> = {}
      await Promise.all(
        fiscalYearsRes.data.map(async (fy: FiscalYear) => {
          try {
            const accountsRes = await accountApi.list(selectedCompany.id, fy.id)
            accountCounts[fy.id] = accountsRes.data.length
          } catch {
            accountCounts[fy.id] = 0
          }
        })
      )
      setAccountCountsByFiscalYear(accountCounts)

      // If we have a selected fiscal year, load accounts
      if (selectedFiscalYear) {
        const [accountsRes, templatesRes] = await Promise.all([
          accountApi.list(selectedCompany.id, selectedFiscalYear.id),
          postingTemplateApi.list(selectedCompany.id).catch(() => ({ data: [] })),
        ])
        setAllAccounts(accountsRes.data)
        setTemplates(templatesRes.data)
      }
    } catch (error: any) {
      console.error('Failed to load data:', error)
      showToast('Kunde inte ladda data', 'error')
    } finally {
      setLoading(false)
    }
  }

  const loadAttachments = async () => {
    if (!selectedCompany) return
    setLoadingAttachments(true)
    try {
      const res = await attachmentApi.list(selectedCompany.id)
      setAttachments(res.data)
    } catch (err) {
      console.error('Failed to load attachments:', err)
    } finally {
      setLoadingAttachments(false)
    }
  }

  const handleDeleteAttachment = async (id: number) => {
    setDeletingAttachment(id)
    try {
      await attachmentApi.delete(id)
      setAttachments(prev => prev.filter(a => a.id !== id))
      showToast('Bilagan har raderats', 'success')
    } catch (err: any) {
      const detail = err.response?.data?.detail || 'Kunde inte radera bilagan'
      showToast(detail, 'error')
    } finally {
      setDeletingAttachment(null)
    }
  }

  // Convert unlinked attachments to EntityAttachment format for preview
  const unlinkedEntityAttachments = useMemo(() =>
    attachments
      .filter(a => a.links?.length === 0)
      .map(a => ({
        link_id: 0,
        attachment_id: a.id,
        role: AttachmentRole.ORIGINAL,
        sort_order: 0,
        created_at: a.created_at,
        original_filename: a.original_filename,
        mime_type: a.mime_type,
        size_bytes: a.size_bytes,
        status: a.status,
      })),
    [attachments]
  )

  const {
    openPreview,
    floatingPreview,
  } = useAttachmentPreviewController(unlinkedEntityAttachments, {
    modalType: ModalType.ATTACHMENT_PREVIEW
  })

  const startEditPaymentInfo = () => {
    if (!selectedCompany) return
    setPaymentForm({
      payment_type: selectedCompany.payment_type || '',
      bankgiro_number: selectedCompany.bankgiro_number || '',
      plusgiro_number: selectedCompany.plusgiro_number || '',
      clearing_number: selectedCompany.clearing_number || '',
      account_number: selectedCompany.account_number || '',
      iban: selectedCompany.iban || '',
      bic: selectedCompany.bic || '',
    })
    setEditingPaymentInfo(true)
  }

  const cancelEditPaymentInfo = () => {
    setEditingPaymentInfo(false)
  }

  const handleUpdatePaymentInfo = async () => {
    if (!selectedCompany) return
    try {
      setLoading(true)
      await companyApi.update(selectedCompany.id, {
        payment_type: paymentForm.payment_type || null,
        bankgiro_number: paymentForm.bankgiro_number || null,
        plusgiro_number: paymentForm.plusgiro_number || null,
        clearing_number: paymentForm.clearing_number || null,
        account_number: paymentForm.account_number || null,
        iban: paymentForm.iban || null,
        bic: paymentForm.bic || null,
      })
      await loadCompanies()
      setEditingPaymentInfo(false)
      showToast('Betalningsuppgifter uppdaterade', 'success')
    } catch (error: any) {
      const detail = error.response?.data?.detail || 'Kunde inte uppdatera betalningsuppgifter'
      showToast(detail, 'error')
    } finally {
      setLoading(false)
    }
  }



  const handleLogoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedCompany || !event.target.files || event.target.files.length === 0) return

    const file = event.target.files[0]
    
    // Validate file type
    if (!file.type.startsWith('image/')) {
      showToast('Filen måste vara en bild', 'error')
      return
    }
    
    if (!['image/png', 'image/jpeg', 'image/jpg'].includes(file.type)) {
      showToast('Endast PNG och JPG filer är tillåtna', 'error')
      return
    }
    
    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      showToast('Filstorleken får inte överstiga 5MB', 'error')
      return
    }

    setUploadingLogo(true)
    try {
      const response = await companyApi.uploadLogo(selectedCompany.id, file)
      setSelectedCompany(response.data)
      showToast('Logotyp uppladdad', 'success')
      
      // Clear the input so the same file can be selected again if needed
      event.target.value = ''
    } catch (error: any) {
      console.error('Logo upload failed:', error)
      showToast(error.response?.data?.detail || 'Uppladdning misslyckades', 'error')
    } finally {
      setUploadingLogo(false)
    }
  }

  const handleLogoDelete = async () => {
    if (!selectedCompany || !selectedCompany.logo_filename) return
    
    if (!confirm('Är du säker på att du vill ta bort logotypen?')) return

    try {
      const response = await companyApi.deleteLogo(selectedCompany.id)
      setSelectedCompany(response.data)
      showToast('Logotyp borttagen', 'success')
    } catch (error: any) {
      console.error('Logo delete failed:', error)
      showToast(error.response?.data?.detail || 'Borttagning misslyckades', 'error')
    }
  }

  const startEditCompany = () => {
    if (!selectedCompany) return
    setCompanyForm({
      name: selectedCompany.name,
      org_number: selectedCompany.org_number,
      address: selectedCompany.address || '',
      postal_code: selectedCompany.postal_code || '',
      city: selectedCompany.city || '',
      phone: selectedCompany.phone || '',
      email: selectedCompany.email || '',
      fiscal_year_start: selectedCompany.fiscal_year_start,
      fiscal_year_end: selectedCompany.fiscal_year_end,
      vat_number: selectedCompany.vat_number || '',
      accounting_basis: selectedCompany.accounting_basis,
      vat_reporting_period: selectedCompany.vat_reporting_period,
      is_vat_registered: selectedCompany.is_vat_registered ?? true,
    })
    setEditingCompany(true)
  }

  const cancelEditCompany = () => {
    setEditingCompany(false)
    setCompanyForm({
      name: '',
      org_number: '',
      address: '',
      postal_code: '',
      city: '',
      phone: '',
      email: '',
      fiscal_year_start: new Date().getFullYear() + '-01-01',
      fiscal_year_end: new Date().getFullYear() + '-12-31',
      vat_number: '',
      accounting_basis: AccountingBasis.ACCRUAL,
      vat_reporting_period: VATReportingPeriod.QUARTERLY,
      is_vat_registered: true,
    })
  }

  const formatErrorMessage = (error: any): string => {
    if (error.response?.data?.detail) {
      const detail = error.response.data.detail
      // If detail is an array of validation errors
      if (Array.isArray(detail)) {
        return detail.map((err: any) => {
          const field = err.loc?.slice(-1)[0] || 'okänt fält'
          const message = err.msg || err.type || 'valideringsfel'
          return `• ${field}: ${message}`
        }).join('\n')
      }
      // If detail is a string
      if (typeof detail === 'string') {
        return detail
      }
      // If detail is an object, try to stringify it
      return JSON.stringify(detail, null, 2)
    }
    return `Ett fel uppstod: ${error.message || 'Okänt fel'}`
  }

  const handleUpdateCompany = async () => {
    if (!selectedCompany) return

    try {
      setLoading(true)
      const response = await companyApi.update(selectedCompany.id, companyForm)
      setSelectedCompany(response.data)
      showToast('Företagsinformation uppdaterad!', 'success')
      setEditingCompany(false)
      await loadCompanies()
    } catch (error: any) {
      console.error('Failed to update company:', error)
      showToast(formatErrorMessage(error), 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleCreateCompany = async () => {
    try {
      setLoading(true)
      const response = await companyApi.create(companyForm)
      showToast('Nytt företag skapat!', 'success')
      setShowCreateCompany(false)
      setCompanyForm({
        name: '',
        org_number: '',
        address: '',
        postal_code: '',
        city: '',
        phone: '',
        email: '',
        fiscal_year_start: new Date().getFullYear() + '-01-01',
        fiscal_year_end: new Date().getFullYear() + '-12-31',
        vat_number: '',
        accounting_basis: AccountingBasis.ACCRUAL,
        vat_reporting_period: VATReportingPeriod.QUARTERLY,
        is_vat_registered: true,
      })
      await loadCompanies()
      setSelectedCompany(response.data)
    } catch (error: any) {
      console.error('Failed to create company:', error)
      showToast(formatErrorMessage(error), 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleSIE4Export = async (includeVerifications: boolean) => {
    if (!selectedCompany || !selectedFiscalYear) {
      showToast('Välj ett räkenskapsår först', 'error')
      return
    }

    try {
      setLoading(true)
      const response = await sie4Api.export(selectedCompany.id, selectedFiscalYear.id, includeVerifications)

      // Create download link
      const blob = new Blob([response.data], { type: 'text/plain' })
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `reknir_export_${new Date().toISOString().split('T')[0]}.se`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)

      showToast('Export lyckades!', 'success')
    } catch (error: any) {
      console.error('SIE4 export failed:', error)
      showToast('Export misslyckades', 'error')
    } finally {
      setLoading(false)
    }
  }

  const loadBackups = async () => {
    setLoadingBackups(true)
    try {
      const response = await backupApi.list()
      setBackups(response.data)
    } catch (error: any) {
      console.error('Failed to load backups:', error)
      showToast('Kunde inte ladda backups', 'error')
    } finally {
      setLoadingBackups(false)
    }
  }

  const handleCreateBackup = async () => {
    setCreatingBackup(true)
    try {
      await backupApi.create()
      showToast('Backup skapad!', 'success')
      loadBackups()
    } catch (error: any) {
      console.error('Backup creation failed:', error)
      showToast(error.response?.data?.detail || 'Kunde inte skapa backup', 'error')
    } finally {
      setCreatingBackup(false)
    }
  }

  const handleDeleteBackup = async () => {
    if (!backupToDelete) return
    setDeletingBackup(backupToDelete)
    try {
      await backupApi.delete(backupToDelete)
      showToast('Backup raderad', 'success')
      loadBackups()
    } catch (error: any) {
      showToast(error.response?.data?.detail || 'Kunde inte radera backup', 'error')
    } finally {
      setDeletingBackup(null)
      setBackupToDelete(null)
    }
  }

  const loadSchedule = async () => {
    try {
      const response = await backupApi.getSchedule()
      setSchedule(response.data)
      setScheduleForm({
        enabled: response.data.enabled,
        interval_hours: response.data.interval_hours,
        max_backups: response.data.max_backups,
        preferred_time: utcTimeToLocal(response.data.preferred_time),
      })
    } catch (error: any) {
      console.error('Failed to load schedule:', error)
    }
  }

  const handleSaveSchedule = async () => {
    setSavingSchedule(true)
    try {
      const payload = { ...scheduleForm, preferred_time: localTimeToUtc(scheduleForm.preferred_time) }
      const response = await backupApi.updateSchedule(payload)
      setSchedule(response.data)
      showToast('Schemaläggning sparad!', 'success')
    } catch (error: any) {
      showToast(error.response?.data?.detail || 'Kunde inte spara schemaläggning', 'error')
    } finally {
      setSavingSchedule(false)
    }
  }

  const handleDownloadBackup = async (filename: string) => {
    setDownloadingBackup(filename)
    try {
      const response = await backupApi.download(filename)

      const blob = new Blob([response.data], { type: 'application/gzip' })
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)

      showToast('Backup nedladdad', 'success')
    } catch (error: any) {
      console.error('Backup download failed:', error)
      showToast('Kunde inte ladda ner backup', 'error')
    } finally {
      setDownloadingBackup(null)
    }
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const formatBackupDate = (dateString: string): string => {
    return new Date(dateString).toLocaleString('sv-SE', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    })
  }

  // Convert "HH:MM" in UTC to "HH:MM" in the browser's local timezone
  const utcTimeToLocal = (utcTime: string): string => {
    const [h, m] = utcTime.split(':').map(Number)
    const d = new Date()
    d.setUTCHours(h, m, 0, 0)
    return d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
  }

  // Convert "HH:MM" in the browser's local timezone to "HH:MM" in UTC
  const localTimeToUtc = (localTime: string): string => {
    const [h, m] = localTime.split(':').map(Number)
    const d = new Date()
    d.setHours(h, m, 0, 0)
    return d.toISOString().slice(11, 16)
  }

  const handleVATReportingPeriodChange = async (newPeriod: VATReportingPeriod) => {
    if (!selectedCompany) return

    try {
      setLoading(true)
      await companyApi.update(selectedCompany.id, { vat_reporting_period: newPeriod })
      setSelectedCompany({ ...selectedCompany, vat_reporting_period: newPeriod })
      showToast('Momsredovisningsperiod uppdaterad!', 'success')
    } catch (error: any) {
      console.error('Failed to update VAT reporting period:', error)
      showToast('Kunde inte uppdatera momsredovisningsperiod', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleCreateFiscalYear = async () => {
    if (!selectedCompany) return

    if (!newFiscalYear.label || !newFiscalYear.start_date || !newFiscalYear.end_date) {
      showToast('Fyll i alla fält', 'error')
      return
    }

    try {
      setLoading(true)

      // Step 1: Create the new fiscal year
      const createResponse = await fiscalYearApi.create({
        company_id: selectedCompany.id,
        year: newFiscalYear.year,
        label: newFiscalYear.label,
        start_date: newFiscalYear.start_date,
        end_date: newFiscalYear.end_date,
        is_closed: false,
      })

      const newFiscalYearId = createResponse.data.id

      // Step 2: Copy chart of accounts from previous fiscal year
      // This automatically finds the most recent previous fiscal year
      showToast('Räkenskapsår skapat! Kopierar kontoplan från föregående år...', 'success')

      try {
        const copyResponse = await fiscalYearApi.copyChartOfAccounts(newFiscalYearId)
        showToast(`Räkenskapsår och kontoplan skapade! ${copyResponse.data.accounts_copied} konton kopierade från ${copyResponse.data.source_fiscal_year_label}.`, 'success')
      } catch (copyError: any) {
        console.error('Failed to copy chart of accounts:', copyError)
        const errorDetail = copyError.response?.data?.detail || 'Kunde inte kopiera kontoplan'
        showToast(`Räkenskapsår skapat, men ${errorDetail}. Du kan importera BAS-kontoplan manuellt i fliken "Import".`, 'error')
      }

      await loadData()
      setShowCreateFiscalYear(false)
      // Reset to next year defaults after creating
      setTimeout(() => {
        setNewFiscalYear(getNextFiscalYearDefaults())
      }, 100)
    } catch (error: any) {
      console.error('Failed to create fiscal year:', error)
      showToast(error.response?.data?.detail || 'Kunde inte skapa räkenskapsår', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteFiscalYear = async (fiscalYearId: number, label: string) => {
    const accountCount = accountCountsByFiscalYear[fiscalYearId] || 0
    let confirmMessage = `Är du säker på att du vill radera räkenskapsåret "${label}"?`

    if (accountCount > 0) {
      confirmMessage = `VARNING: Räkenskapsåret "${label}" har ${accountCount} konton som kommer att raderas permanent.\n\nÄr du säker på att du vill fortsätta?`
    } else {
      confirmMessage += ' Verifikationer kommer att kopplas loss.'
    }

    if (!confirm(confirmMessage)) {
      return
    }

    try {
      setLoading(true)
      await fiscalYearApi.delete(fiscalYearId)
      showToast('Räkenskapsår raderat', 'success')
      await loadData()
    } catch (error: any) {
      console.error('Failed to delete fiscal year:', error)
      showToast('Kunde inte radera räkenskapsår', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleAssignVerifications = async (fiscalYearId: number, label: string) => {
    if (!confirm(`Tilldela alla verifikationer till räkenskapsår "${label}" baserat på transaktionsdatum?`)) {
      return
    }

    try {
      setLoading(true)
      const result = await fiscalYearApi.assignVerifications(fiscalYearId)
      showToast(result.data.message, 'success')
      await loadData()
    } catch (error: any) {
      console.error('Failed to assign verifications:', error)
      showToast('Kunde inte tilldela verifikationer', 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleYearChange = (year: number) => {
    setNewFiscalYear({
      year,
      label: `${year}`,
      start_date: `${year}-01-01`,
      end_date: `${year}-12-31`,
    })
  }

  const handleToggleCreateForm = () => {
    if (!showCreateFiscalYear) {
      // Opening form - reset to defaults
      setNewFiscalYear(getNextFiscalYearDefaults())
    }
    setShowCreateFiscalYear(!showCreateFiscalYear)
  }

  const handleCreateTemplate = () => {
    setEditingTemplate(null)
    setTemplateForm({
      company_id: selectedCompany?.id || 0,
      name: '',
      description: '',
      default_series: '',
      default_journal_text: '',
      template_lines: [{
        account_number: 0,
        formula: '{total}',
        description: '',
        sort_order: 0
      }]
    })
    setShowCreateTemplate(true)
  }

  const handleEditTemplate = async (template: PostingTemplate) => {
    if (!selectedCompany || !template.id) return

    try {
      const response = await postingTemplateApi.get(template.id)
      setEditingTemplate(template)
      setTemplateForm(response.data)
      setShowCreateTemplate(true)
    } catch (error) {
      showToast('Kunde inte ladda mall', 'error')
    }
  }

  const handleSaveTemplate = async () => {
    if (!selectedCompany) return

    if (!templateForm.name || !templateForm.description || templateForm.template_lines.length === 0) {
      showToast('Fyll i alla obligatoriska fält', 'error')
      return
    }

    // Validate template lines
    for (const line of templateForm.template_lines) {
      if (!line.account_number || !line.formula) {
        showToast('Alla rader måste ha konto och formel', 'error')
        return
      }
    }

    try {
      setLoading(true)

      if (editingTemplate && editingTemplate.id) {
        await postingTemplateApi.update(editingTemplate.id, templateForm)
        showToast('Mall uppdaterad', 'success')
      } else {
        await postingTemplateApi.create(templateForm)
        showToast('Mall skapad', 'success')
      }

      setShowCreateTemplate(false)
      setEditingTemplate(null)
      loadData()
    } catch (error: any) {
      showToast(error.response?.data?.detail || 'Kunde inte spara mall', 'error')
    } finally {
      setLoading(false)
    }
  }

  const addTemplateLine = () => {
    setTemplateForm(prev => ({
      ...prev,
      template_lines: [...prev.template_lines, {
        account_number: 0,
        formula: '{total}',
        description: '',
        sort_order: prev.template_lines.length
      }]
    }))
  }

  const removeTemplateLine = (index: number) => {
    setTemplateForm(prev => ({
      ...prev,
      template_lines: prev.template_lines.filter((_, i) => i !== index)
    }))
  }

  const updateTemplateLine = (index: number, field: keyof PostingTemplateLine, value: any) => {
    setTemplateForm(prev => ({
      ...prev,
      template_lines: prev.template_lines.map((line, i) => 
        i === index ? { ...line, [field]: value } : line
      )
    }))
  }

  // Simple drag and drop state
  const [draggedTemplate, setDraggedTemplate] = useState<PostingTemplate | null>(null)
  const [dropIndicator, setDropIndicator] = useState<{ templateId: number; position: 'before' | 'after' } | null>(null)

  const handleDragStart = (e: any, template: PostingTemplate) => {
    setDraggedTemplate(template)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', template.id?.toString() || '')
  }

  const handleDragEnd = () => {
    setDraggedTemplate(null)
    setDropIndicator(null)
  }

  const handleDragOver = (e: any, template: PostingTemplate) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'

    if (!draggedTemplate || !template.id || draggedTemplate.id === template.id) return

    // Calculate if drop should be before or after based on mouse position
    const rect = e.currentTarget.getBoundingClientRect()
    const midY = rect.top + rect.height / 2
    const position = e.clientY < midY ? 'before' : 'after'

    setDropIndicator({ templateId: template.id, position })
  }

  const handleDragLeave = (e: any) => {
    // Only clear if we're leaving the container entirely
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX
    const y = e.clientY
    
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setDropIndicator(null)
    }
  }

  const handleDrop = async (e: any, targetTemplate: PostingTemplate) => {
    e.preventDefault()

    if (!draggedTemplate || !selectedCompany || draggedTemplate.id === targetTemplate.id || !dropIndicator) {
      handleDragEnd()
      return
    }

    const sortedTemplates = [...templates].sort((a: any, b: any) => (a.sort_order || 999) - (b.sort_order || 999))
    const draggedIndex = sortedTemplates.findIndex((t: any) => t.id === draggedTemplate.id)
    const targetIndex = sortedTemplates.findIndex((t: any) => t.id === targetTemplate.id)

    if (draggedIndex === -1 || targetIndex === -1) {
      handleDragEnd()
      return
    }

    // Calculate the insertion point based on drop indicator
    let insertIndex = targetIndex
    if (dropIndicator.position === 'after') {
      insertIndex = targetIndex + 1
    }

    // Adjust for removal of dragged item
    if (draggedIndex < insertIndex) {
      insertIndex -= 1
    }

    // Create reordered list
    const reorderedTemplates = Array.from(sortedTemplates)
    const [movedTemplate] = reorderedTemplates.splice(draggedIndex, 1)
    reorderedTemplates.splice(insertIndex, 0, movedTemplate)

    // Update sort_order on each template and set state immediately for smooth UX
    const updatedTemplates = reorderedTemplates.map((template: any, index: number) => ({
      ...template,
      sort_order: index + 1
    }))
    setTemplates(updatedTemplates)
    handleDragEnd()

    try {
      // Create the new order array for the API call
      const templateOrders = updatedTemplates.map((template: any) => ({
        id: template.id,
        sort_order: template.sort_order
      }))

      await postingTemplateApi.reorder(selectedCompany.id, templateOrders)
      showToast('Ordning uppdaterad', 'success')
    } catch (error: any) {
      // Revert the local change if API call fails
      setTemplates(templates)
      showToast('Kunde inte uppdatera ordning', 'error')
    }
  }

  if (!selectedCompany && !loading) {
    return (
      <div className="card">
        <h2 className="text-2xl font-bold mb-4">Inställningar</h2>
        <p className="text-gray-600">
          Inget företag hittat. Skapa ett företag först.
        </p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <h1 className="text-3xl font-bold">Inställningar</h1>
        <FiscalYearSelector />
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('company')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'company'
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Företag
          </button>
          <button
            onClick={() => setActiveTab('fiscal')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'fiscal'
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Räkenskapsår
          </button>
          <button
            onClick={() => setActiveTab('templates')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'templates'
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Konteringsmallar
          </button>
          <button
            onClick={() => setActiveTab('import')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'import'
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Import/Export
          </button>
          <button
            onClick={() => setActiveTab('layout')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'layout'
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            Bilagor
          </button>
          {user?.is_admin && (
            <button
              onClick={() => {
                setActiveTab('ai')
                loadAiSettings()
              }}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'ai'
                  ? 'border-primary-500 text-primary-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              AI-assistent
            </button>
          )}
        </nav>
      </div>

      {/* Company Tab */}
      {activeTab === 'company' && (
        <div>
          {/* Company Management Section */}
          <div className="card mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Building2 className="w-5 h-5" />
            Företagsinformation
          </h2>
          <div className="flex gap-2">
            {!editingCompany && !showCreateCompany && (
              <>
                <button
                  onClick={startEditCompany}
                  disabled={loading}
                  className="btn btn-secondary flex items-center gap-2"
                >
                  <Edit2 className="w-4 h-4" />
                  Redigera
                </button>
                <button
                  onClick={() => setShowCreateCompany(true)}
                  disabled={loading}
                  className="btn btn-primary flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Nytt företag
                </button>
              </>
            )}
          </div>
        </div>

        {/* View Mode */}
        {!editingCompany && !showCreateCompany && selectedCompany && (
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">Grunduppgifter</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Företagsnamn</label>
                  <p className="text-gray-900">{selectedCompany.name}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Organisationsnummer</label>
                  <p className="text-gray-900">{selectedCompany.org_number}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Momsregistrerad</label>
                  <p className="text-gray-900">{selectedCompany.is_vat_registered ? 'Ja' : 'Nej'}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">VAT-nummer</label>
                  <p className="text-gray-900">
                    {selectedCompany.is_vat_registered
                      ? (selectedCompany.vat_number || '-')
                      : 'Ej momsregistrerad'}
                  </p>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">Kontaktuppgifter</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Adress</label>
                  <p className="text-gray-900">{selectedCompany.address || '-'}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Postnummer</label>
                  <p className="text-gray-900">{selectedCompany.postal_code || '-'}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Stad</label>
                  <p className="text-gray-900">{selectedCompany.city || '-'}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Telefon</label>
                  <p className="text-gray-900">{selectedCompany.phone || '-'}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">E-post</label>
                  <p className="text-gray-900">{selectedCompany.email || '-'}</p>
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">Bokföringsinställningar</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Räkenskapsår start</label>
                  <p className="text-gray-900">{selectedCompany.fiscal_year_start}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Räkenskapsår slut</label>
                  <p className="text-gray-900">{selectedCompany.fiscal_year_end}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Bokföringsmetod</label>
                  <p className="text-gray-900">
                    {selectedCompany.accounting_basis === 'accrual' ? 'Bokföringsmässiga grunder' : 'Kontantmetoden'}
                  </p>
                </div>
                {selectedCompany.is_vat_registered && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Momsredovisning</label>
                    <p className="text-gray-900">
                      {selectedCompany.vat_reporting_period === 'monthly' ? 'Månadsvis' :
                       selectedCompany.vat_reporting_period === 'quarterly' ? 'Kvartalsvis' : 'Årlig'}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Edit/Create Mode */}
        {(editingCompany || showCreateCompany) && (
          <div className="space-y-6">
            {/* Grunduppgifter */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">Grunduppgifter</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Företagsnamn *
                  </label>
                  <input
                    type="text"
                    value={companyForm.name}
                    onChange={(e) => setCompanyForm({ ...companyForm, name: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Organisationsnummer *
                  </label>
                  <input
                    type="text"
                    value={companyForm.org_number}
                    onChange={(e) => setCompanyForm({ ...companyForm, org_number: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    placeholder="123456-7890 eller 1234567890"
                    pattern="^\d{6}-?\d{4}$"
                    required
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    10 siffror, med eller utan bindestreck (t.ex. 123456-7890)
                  </p>
                </div>
              </div>
            </div>

            {/* Kontaktuppgifter */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">Kontaktuppgifter</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">Adress</label>
                  <input
                    type="text"
                    value={companyForm.address}
                    onChange={(e) => setCompanyForm({ ...companyForm, address: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    placeholder="Gatunamn 123"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Postnummer</label>
                  <input
                    type="text"
                    value={companyForm.postal_code}
                    onChange={(e) => setCompanyForm({ ...companyForm, postal_code: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    placeholder="123 45"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Stad</label>
                  <input
                    type="text"
                    value={companyForm.city}
                    onChange={(e) => setCompanyForm({ ...companyForm, city: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    placeholder="Stockholm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Telefon</label>
                  <input
                    type="tel"
                    value={companyForm.phone}
                    onChange={(e) => setCompanyForm({ ...companyForm, phone: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    placeholder="08-123 456 78"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">E-post</label>
                  <input
                    type="email"
                    value={companyForm.email}
                    onChange={(e) => setCompanyForm({ ...companyForm, email: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    placeholder="info@företag.se"
                  />
                </div>
              </div>
            </div>

            {/* Bokföringsinställningar */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">Bokföringsinställningar</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Räkenskapsår start *
                  </label>
                  <input
                    type="date"
                    value={companyForm.fiscal_year_start}
                    onChange={(e) => setCompanyForm({ ...companyForm, fiscal_year_start: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Räkenskapsår slut *
                  </label>
                  <input
                    type="date"
                    value={companyForm.fiscal_year_end}
                    onChange={(e) => setCompanyForm({ ...companyForm, fiscal_year_end: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Bokföringsmetod
                  </label>
                  <select
                    value={companyForm.accounting_basis}
                    onChange={(e) => setCompanyForm({ ...companyForm, accounting_basis: e.target.value as AccountingBasis })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  >
                    <option value="accrual">Bokföringsmässiga grunder</option>
                    <option value="cash">Kontantmetoden</option>
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={companyForm.is_vat_registered}
                      onChange={(e) => setCompanyForm({ ...companyForm, is_vat_registered: e.target.checked })}
                      className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
                    />
                    <span className="text-sm font-medium text-gray-700">
                      Företaget är momsregistrerat
                    </span>
                  </label>
                  <p className="mt-1 text-xs text-gray-500 ml-6">
                    Avmarkera om företaget inte är registrerat för moms hos Skatteverket
                  </p>
                </div>
                <div>
                  <label className={`block text-sm font-medium mb-1 ${companyForm.is_vat_registered ? 'text-gray-700' : 'text-gray-400'}`}>
                    Momsredovisningsperiod
                  </label>
                  <select
                    value={companyForm.vat_reporting_period}
                    onChange={(e) => setCompanyForm({ ...companyForm, vat_reporting_period: e.target.value as VATReportingPeriod })}
                    disabled={!companyForm.is_vat_registered}
                    className={`w-full px-3 py-2 border border-gray-300 rounded-md ${
                      !companyForm.is_vat_registered ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : ''
                    }`}
                  >
                    <option value="monthly">Månadsvis</option>
                    <option value="quarterly">Kvartalsvis</option>
                    <option value="yearly">Årlig</option>
                  </select>
                  {!companyForm.is_vat_registered && (
                    <p className="mt-1 text-xs text-gray-400">
                      Ej relevant för företag som inte är momsregistrerade
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="flex gap-2 pt-4 border-t">
              <button
                onClick={editingCompany ? handleUpdateCompany : handleCreateCompany}
                disabled={loading || !companyForm.name || !companyForm.org_number}
                className="btn btn-primary flex items-center gap-2"
              >
                <Save className="w-4 h-4" />
                {editingCompany ? 'Spara ändringar' : 'Skapa företag'}
              </button>
              <button
                onClick={editingCompany ? cancelEditCompany : () => setShowCreateCompany(false)}
                disabled={loading}
                className="btn btn-secondary flex items-center gap-2"
              >
                <X className="w-4 h-4" />
                Avbryt
              </button>
            </div>
          </div>
        )}

        {/* List of all companies */}
        {companies.length > 1 && !editingCompany && !showCreateCompany && (
          <div className="mt-6 pt-6 border-t">
            <h3 className="text-sm font-medium text-gray-700 mb-3">Alla företag ({companies.length})</h3>
            <div className="space-y-2">
              {companies.map((company) => (
                <div
                  key={company.id}
                  className={`flex items-center justify-between p-3 rounded-lg border ${
                    selectedCompany?.id === company.id
                      ? 'border-primary-500 bg-primary-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div>
                    <p className="font-medium text-gray-900">{company.name}</p>
                    <p className="text-sm text-gray-600">Org.nr: {company.org_number}</p>
                  </div>
                  {selectedCompany?.id !== company.id && (
                    <button
                      onClick={() => setSelectedCompany(company)}
                      className="text-sm text-primary-600 hover:text-primary-700 font-medium"
                    >
                      Välj
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

          {/* Payment Information Card */}
          {selectedCompany && (
            <div className="card mb-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold flex items-center gap-2">
                  <CreditCard className="w-5 h-5" />
                  Betalningsuppgifter
                </h2>
                {!editingPaymentInfo && !editingCompany && (
                  <button
                    onClick={startEditPaymentInfo}
                    className="btn btn-secondary flex items-center gap-2"
                  >
                    <Edit2 className="w-4 h-4" />
                    Redigera
                  </button>
                )}
              </div>
              <p className="text-gray-600 mb-4">
                Dessa uppgifter visas på fakturor för att ange hur kunden ska betala.
              </p>

              {editingPaymentInfo ? (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Betalningstyp
                    </label>
                    <select
                      value={paymentForm.payment_type}
                      onChange={(e) => setPaymentForm({ ...paymentForm, payment_type: e.target.value as PaymentType | '' })}
                      className="w-full md:w-1/2 px-3 py-2 border border-gray-300 rounded-md"
                    >
                      <option value="">Välj betalningstyp...</option>
                      <option value={PaymentType.BANKGIRO}>Bankgiro</option>
                      <option value={PaymentType.PLUSGIRO}>Plusgiro</option>
                      <option value={PaymentType.BANK_ACCOUNT}>Bankkonto</option>
                    </select>
                  </div>

                  {/* Bankgiro fields */}
                  {paymentForm.payment_type === PaymentType.BANKGIRO && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Bankgironummer <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={paymentForm.bankgiro_number}
                        onChange={(e) => setPaymentForm({ ...paymentForm, bankgiro_number: e.target.value })}
                        className="w-full md:w-1/2 px-3 py-2 border border-gray-300 rounded-md"
                        placeholder="t.ex. 123-4567"
                      />
                    </div>
                  )}

                  {/* Plusgiro fields */}
                  {paymentForm.payment_type === PaymentType.PLUSGIRO && (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Plusgironummer <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={paymentForm.plusgiro_number}
                        onChange={(e) => setPaymentForm({ ...paymentForm, plusgiro_number: e.target.value })}
                        className="w-full md:w-1/2 px-3 py-2 border border-gray-300 rounded-md"
                        placeholder="t.ex. 12 34 56-7"
                      />
                    </div>
                  )}

                  {/* Bank account fields */}
                  {paymentForm.payment_type === PaymentType.BANK_ACCOUNT && (
                    <>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Clearingnummer <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="text"
                            value={paymentForm.clearing_number}
                            onChange={(e) => setPaymentForm({ ...paymentForm, clearing_number: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md"
                            placeholder="t.ex. 1234"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            Kontonummer <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="text"
                            value={paymentForm.account_number}
                            onChange={(e) => setPaymentForm({ ...paymentForm, account_number: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md"
                            placeholder="t.ex. 12 345 67"
                          />
                        </div>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            IBAN <span className="text-gray-400">(valfritt)</span>
                          </label>
                          <input
                            type="text"
                            value={paymentForm.iban}
                            onChange={(e) => setPaymentForm({ ...paymentForm, iban: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md"
                            placeholder="t.ex. SE12 3456 7890 1234 5678 9012"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            BIC/SWIFT <span className="text-gray-400">(valfritt)</span>
                          </label>
                          <input
                            type="text"
                            value={paymentForm.bic}
                            onChange={(e) => setPaymentForm({ ...paymentForm, bic: e.target.value })}
                            className="w-full px-3 py-2 border border-gray-300 rounded-md"
                            placeholder="t.ex. NDEASESS"
                          />
                        </div>
                      </div>
                      <p className="text-sm text-gray-500">
                        IBAN och BIC visas på fakturan om de är ifyllda (för internationella betalningar).
                      </p>
                    </>
                  )}

                  {editingPaymentInfo && (
                    <div className="flex gap-2 mt-4">
                      <button
                        onClick={handleUpdatePaymentInfo}
                        disabled={loading}
                        className="btn btn-primary flex items-center gap-2"
                      >
                        <Save className="w-4 h-4" />
                        {loading ? 'Sparar...' : 'Spara'}
                      </button>
                      <button
                        onClick={cancelEditPaymentInfo}
                        disabled={loading}
                        className="btn btn-secondary flex items-center gap-2"
                      >
                        <X className="w-4 h-4" />
                        Avbryt
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  {selectedCompany.payment_type ? (
                    <>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-600">Betalningstyp:</span>
                        <span className="text-gray-900">
                          {selectedCompany.payment_type === PaymentType.BANKGIRO ? 'Bankgiro' :
                           selectedCompany.payment_type === PaymentType.PLUSGIRO ? 'Plusgiro' :
                           'Bankkonto'}
                        </span>
                      </div>
                      {selectedCompany.payment_type === PaymentType.BANKGIRO && selectedCompany.bankgiro_number && (
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-600">Bankgironummer:</span>
                          <span className="text-gray-900 font-mono">{selectedCompany.bankgiro_number}</span>
                        </div>
                      )}
                      {selectedCompany.payment_type === PaymentType.PLUSGIRO && selectedCompany.plusgiro_number && (
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-600">Plusgironummer:</span>
                          <span className="text-gray-900 font-mono">{selectedCompany.plusgiro_number}</span>
                        </div>
                      )}
                      {selectedCompany.payment_type === PaymentType.BANK_ACCOUNT && (
                        <>
                          {selectedCompany.clearing_number && selectedCompany.account_number && (
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-gray-600">Kontonummer:</span>
                              <span className="text-gray-900 font-mono">
                                {selectedCompany.clearing_number}-{selectedCompany.account_number}
                              </span>
                            </div>
                          )}
                          {selectedCompany.iban && (
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-gray-600">IBAN:</span>
                              <span className="text-gray-900 font-mono">{selectedCompany.iban}</span>
                            </div>
                          )}
                          {selectedCompany.bic && (
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-gray-600">BIC:</span>
                              <span className="text-gray-900 font-mono">{selectedCompany.bic}</span>
                            </div>
                          )}
                        </>
                      )}
                    </>
                  ) : (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                      <p className="text-yellow-800">
                        <strong>Inga betalningsuppgifter angivna.</strong> Du måste ange betalningsuppgifter innan du kan skapa fakturor.
                      </p>
                      <button
                        onClick={startEditPaymentInfo}
                        className="mt-2 text-sm text-yellow-700 underline hover:text-yellow-900"
                      >
                        Lägg till betalningsuppgifter
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

      {/* VAT Reporting Period Section */}
      <div className="card mb-6">
        <h2 className="text-xl font-semibold mb-4">Momsredovisningsperiod</h2>

        {selectedCompany?.is_vat_registered ? (
          <>
            <p className="text-gray-600 mb-4">
              Välj hur ofta ditt företag ska redovisa moms till Skatteverket.
            </p>

            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3">
                {/* Monthly Option */}
                <label className={`flex items-start p-4 border-2 rounded-lg cursor-pointer transition-colors ${
                  selectedCompany?.vat_reporting_period === 'monthly'
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}>
                  <input
                    type="radio"
                    name="vat_period"
                    value="monthly"
                    checked={selectedCompany?.vat_reporting_period === 'monthly'}
                    onChange={(e) => handleVATReportingPeriodChange(e.target.value as VATReportingPeriod)}
                    disabled={loading}
                    className="mt-1 mr-3"
                  />
                  <div className="flex-1">
                    <div className="font-medium text-gray-900">Månadsvis</div>
                    <div className="text-sm text-gray-600 mt-1">
                      För företag med omsättning över 40 miljoner SEK/år. Deklarera varje månad.
                    </div>
                  </div>
                </label>

                {/* Quarterly Option */}
                <label className={`flex items-start p-4 border-2 rounded-lg cursor-pointer transition-colors ${
                  selectedCompany?.vat_reporting_period === 'quarterly'
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}>
                  <input
                    type="radio"
                    name="vat_period"
                    value="quarterly"
                    checked={selectedCompany?.vat_reporting_period === 'quarterly'}
                    onChange={(e) => handleVATReportingPeriodChange(e.target.value as VATReportingPeriod)}
                    disabled={loading}
                    className="mt-1 mr-3"
                  />
                  <div className="flex-1">
                    <div className="font-medium text-gray-900">Kvartalsvis (Rekommenderat)</div>
                    <div className="text-sm text-gray-600 mt-1">
                      Vanligast för små och medelstora företag. Deklarera varje kvartal.
                    </div>
                  </div>
                </label>

                {/* Yearly Option */}
                <label className={`flex items-start p-4 border-2 rounded-lg cursor-pointer transition-colors ${
                  selectedCompany?.vat_reporting_period === 'yearly'
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}>
                  <input
                    type="radio"
                    name="vat_period"
                    value="yearly"
                    checked={selectedCompany?.vat_reporting_period === 'yearly'}
                    onChange={(e) => handleVATReportingPeriodChange(e.target.value as VATReportingPeriod)}
                    disabled={loading}
                    className="mt-1 mr-3"
                  />
                  <div className="flex-1">
                    <div className="font-medium text-gray-900">Årlig</div>
                    <div className="text-sm text-gray-600 mt-1">
                      För företag med omsättning under 1 miljon SEK/år. Deklarera en gång per år.
                    </div>
                  </div>
                </label>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded p-3">
                <p className="text-sm text-blue-800">
                  <strong>OBS:</strong> Kontakta Skatteverket om du är osäker på vilken redovisningsperiod
                  som gäller för ditt företag. Detta påverkar hur ofta du måste lämna momsdeklaration.
                </p>
              </div>
            </div>
          </>
        ) : (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
            <p className="text-gray-600">
              Företaget är inte momsregistrerat. Momsredovisningsperiod är därför inte relevant.
            </p>
            <p className="text-sm text-gray-500 mt-2">
              Om företaget blir momsregistrerat kan du aktivera detta under "Redigera" ovan.
            </p>
          </div>
        )}
      </div>

          {/* Company Logo Section */}
          {selectedCompany && (
            <div className="card mb-6">
              <h2 className="text-xl font-semibold mb-4">Företagslogotyp</h2>
              <div className="flex items-start space-x-6">
                {selectedCompany.logo_filename && logoUrl ? (
                  <div className="flex-shrink-0">
                    <div className="relative">
                      <img
                        src={logoUrl}
                        alt="Företagslogotyp"
                        className="w-40 h-40 object-contain border-2 border-gray-300 rounded-lg bg-white shadow-sm"
                        onError={(e) => {
                          const target = e.target as HTMLImageElement
                          target.style.display = 'none'
                        }}
                      />
                      <div className="absolute -top-2 -right-2 bg-green-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold">
                        ✓
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex-shrink-0">
                    <div className="w-40 h-40 border-2 border-dashed border-gray-300 rounded-lg flex flex-col items-center justify-center bg-gray-50">
                      <Image className="w-12 h-12 text-gray-400 mb-2" />
                      <span className="text-sm text-gray-500 text-center">Ingen logotyp<br/>uppladdad</span>
                    </div>
                  </div>
                )}
                <div className="flex-1">
                  <div className="flex flex-col space-y-3">
                    <label className="btn btn-primary cursor-pointer inline-flex items-center w-fit">
                      <Upload className="w-4 h-4 mr-2" />
                      {uploadingLogo ? 'Laddar upp...' : (selectedCompany.logo_filename ? 'Byt logotyp' : 'Ladda upp logotyp')}
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/jpg"
                        onChange={handleLogoUpload}
                        disabled={uploadingLogo}
                        className="hidden"
                      />
                    </label>
                    {selectedCompany.logo_filename && (
                      <button
                        onClick={handleLogoDelete}
                        disabled={uploadingLogo}
                        className="btn btn-outline-danger w-fit inline-flex items-center"
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Ta bort logotyp
                      </button>
                    )}
                  </div>
                  <div className="mt-3">
                    <p className="text-sm text-gray-600 mb-1">
                      Rekommenderad storlek: 200x200 pixlar eller större
                    </p>
                    <p className="text-sm text-gray-500">
                      Filformat: PNG eller JPG, max 5MB
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Import/Export Tab */}
      {activeTab === 'import' && (
        <div>
          {/* Backup Section */}
          <div className="card mb-6">
            <div className="flex items-center gap-2 mb-4">
              <HardDrive className="w-5 h-5 text-gray-600" />
              <h2 className="text-xl font-semibold">Systembackup</h2>
            </div>
            <p className="text-gray-600 mb-4">
              Skapa fullständiga backups av hela systemet, inklusive databas och bilagor.
            </p>

            {/* Create Backup */}
            <div className="mb-6">
              <button
                onClick={handleCreateBackup}
                disabled={creatingBackup || loading}
                className="btn btn-primary inline-flex items-center"
              >
                {creatingBackup ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Skapar backup...
                  </>
                ) : (
                  <>
                    <HardDrive className="w-4 h-4 mr-2" />
                    Skapa backup
                  </>
                )}
              </button>
            </div>

            {/* Schedule Section */}
            <div className="border-t pt-4 mb-6">
              <div className="flex items-center gap-2 mb-3">
                <Clock className="w-4 h-4 text-gray-600" />
                <h3 className="text-sm font-medium text-gray-700">Automatisk backup</h3>
              </div>

              <div className="space-y-4">
                {/* Enable toggle */}
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={scheduleForm.enabled}
                    onChange={(e) => setScheduleForm(prev => ({ ...prev, enabled: e.target.checked }))}
                    className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                  />
                  <span className="text-sm text-gray-700">Aktivera schemalagd backup</span>
                </label>

                {/* Interval and max backups */}
                <div className="flex flex-wrap gap-4">
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Intervall</label>
                    <select
                      value={scheduleForm.interval_hours}
                      onChange={(e) => setScheduleForm(prev => ({ ...prev, interval_hours: Number(e.target.value) }))}
                      disabled={!scheduleForm.enabled}
                      className="input text-sm w-44 disabled:opacity-50"
                    >
                      <option value={6}>Var 6:e timme</option>
                      <option value={24}>Varje dygn</option>
                      <option value={48}>Varannan dag</option>
                      <option value={168}>Varje vecka</option>
                      <option value={336}>Varannan vecka</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Tid</label>
                    <input
                      type="time"
                      value={scheduleForm.preferred_time}
                      onChange={(e) => setScheduleForm(prev => ({ ...prev, preferred_time: e.target.value }))}
                      disabled={!scheduleForm.enabled}
                      className="input text-sm w-28 disabled:opacity-50"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Behåll senaste</label>
                    <input
                      type="number"
                      min={1}
                      value={scheduleForm.max_backups}
                      onChange={(e) => setScheduleForm(prev => ({ ...prev, max_backups: Math.max(1, Number(e.target.value)) }))}
                      disabled={!scheduleForm.enabled}
                      className="input text-sm w-24 disabled:opacity-50"
                    />
                  </div>
                </div>

                {/* Status */}
                {schedule && schedule.enabled && (
                  <div className="text-xs text-gray-500 space-y-1">
                    {schedule.last_backup_at && (
                      <p>Senaste backup: {formatBackupDate(schedule.last_backup_at)}</p>
                    )}
                    {schedule.next_backup_at && (
                      <p>Nästa backup: {formatBackupDate(schedule.next_backup_at)}</p>
                    )}
                  </div>
                )}

                {/* Save button */}
                <button
                  onClick={handleSaveSchedule}
                  disabled={savingSchedule}
                  className="btn btn-secondary inline-flex items-center text-sm"
                >
                  {savingSchedule ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Sparar...
                    </>
                  ) : (
                    <>
                      <Save className="w-4 h-4 mr-2" />
                      Spara inställningar
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Backup List */}
            <div className="border-t pt-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-gray-700">Backups på servern</h3>
                <button
                  onClick={loadBackups}
                  disabled={loadingBackups}
                  className="text-sm text-blue-600 hover:text-blue-800"
                >
                  {loadingBackups ? 'Laddar...' : 'Uppdatera'}
                </button>
              </div>

              {loadingBackups ? (
                <div className="text-center py-4 text-gray-500">
                  <Loader2 className="w-6 h-6 mx-auto mb-2 animate-spin" />
                  Laddar backups...
                </div>
              ) : backups.length === 0 ? (
                <div className="text-center py-4 text-gray-500">
                  <p>Inga backups på servern.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Skapad</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Version</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Schema</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Storlek</th>
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Åtgärder</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {backups.map((backup) => (
                        <tr key={backup.filename} className="hover:bg-gray-50">
                          <td className="px-3 py-2 text-sm text-gray-900">
                            {formatBackupDate(backup.created_at)}
                          </td>
                          <td className="px-3 py-2 text-sm text-gray-600">{backup.app_version}</td>
                          <td className="px-3 py-2 text-sm text-gray-600">{backup.schema_version}</td>
                          <td className="px-3 py-2 text-sm text-gray-600">
                            {formatFileSize(backup.size_bytes)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <button
                                onClick={() => handleDownloadBackup(backup.filename)}
                                disabled={downloadingBackup === backup.filename}
                                className="text-blue-600 hover:text-blue-800 p-1"
                                title="Ladda ner"
                              >
                                {downloadingBackup === backup.filename ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <Download className="w-4 h-4" />
                                )}
                              </button>
                              <button
                                onClick={() => setBackupToDelete(backup.filename)}
                                disabled={deletingBackup === backup.filename}
                                className="text-red-600 hover:text-red-800 p-1"
                                title="Radera"
                              >
                                {deletingBackup === backup.filename ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <Trash2 className="w-4 h-4" />
                                )}
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Restore Button */}
            <div className="border-t mt-4 pt-4">
              <button
                onClick={() => setShowRestoreModal(true)}
                className="btn btn-secondary inline-flex items-center"
              >
                <RotateCcw className="w-4 h-4 mr-2" />
                Återställ från backup
              </button>
              <p className="mt-2 text-sm text-gray-500">
                Återställ systemet från en backup på servern eller ladda upp en backup-fil.
              </p>
            </div>

            <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded">
              <p className="text-sm text-amber-800">
                <strong>Varning:</strong> Återställning ersätter ALL data i systemet. Skapa alltid en backup
                av nuvarande data innan du återställer.
              </p>
            </div>
          </div>

          {/* SIE4 Import/Export Section */}
      <div className="card mb-6">
        <h2 className="text-xl font-semibold mb-4">SIE4 Import/Export</h2>
        <p className="text-gray-600 mb-4">
          Importera eller exportera kontoplan och verifikationer i SIE4-format.
        </p>

        <div className="space-y-4">
          {/* Import */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Importera SIE4-fil
            </label>
            <button
              onClick={() => setShowSIE4ImportModal(true)}
              disabled={loading || !selectedCompany}
              className="btn btn-primary inline-flex items-center"
            >
              <Upload className="w-4 h-4 mr-2" />
              Importera SIE4-fil
            </button>
            <p className="mt-2 text-sm text-gray-500">
              Räkenskapsår skapas automatiskt från filen. Konton och verifikationer importeras med förhandsgranskning.
            </p>
          </div>

          {/* Export */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Exportera till SIE4
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => handleSIE4Export(true)}
                disabled={loading || !selectedFiscalYear}
                className="btn btn-primary"
              >
                Exportera med verifikationer
              </button>
              <button
                onClick={() => handleSIE4Export(false)}
                disabled={loading || !selectedFiscalYear}
                className="btn btn-secondary"
              >
                Endast kontoplan
              </button>
            </div>
            {!selectedFiscalYear && (
              <p className="mt-2 text-sm text-amber-600">
                Välj ett räkenskapsår för att exportera.
              </p>
            )}
          </div>
        </div>
      </div>
        </div>
      )}

      {/* Fiscal Years Tab */}
      {activeTab === 'fiscal' && (
        <div>
          {/* Fiscal Years Section */}
      <div className="card mb-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold">Räkenskapsår</h2>
          <button
            onClick={handleToggleCreateForm}
            disabled={loading}
            className="btn btn-primary inline-flex items-center"
          >
            <Plus className="w-4 h-4 mr-2" />
            Lägg till räkenskapsår
          </button>
        </div>

        <p className="text-gray-600 mb-4">
          Hantera räkenskapsår för att kunna filtrera verifikationer och rapporter per period.
        </p>

        {/* Create Fiscal Year Form */}
        {showCreateFiscalYear && (
          <div className="mb-4 p-4 bg-gray-50 border border-gray-200 rounded-lg">
            <h3 className="font-medium mb-3">Skapa nytt räkenskapsår</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">År</label>
                <input
                  type="number"
                  value={newFiscalYear.year}
                  onChange={(e) => handleYearChange(parseInt(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Benämning</label>
                <input
                  type="text"
                  placeholder="t.ex. 2024"
                  value={newFiscalYear.label}
                  onChange={(e) => setNewFiscalYear({ ...newFiscalYear, label: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                />
                <p className="text-xs text-gray-500 mt-1">Automatiskt ifylld med året</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Startdatum</label>
                <input
                  type="date"
                  value={newFiscalYear.start_date}
                  onChange={(e) => setNewFiscalYear({ ...newFiscalYear, start_date: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                />
                <p className="text-xs text-gray-500 mt-1">Standard: 1 januari</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Slutdatum</label>
                <input
                  type="date"
                  value={newFiscalYear.end_date}
                  onChange={(e) => setNewFiscalYear({ ...newFiscalYear, end_date: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                />
                <p className="text-xs text-gray-500 mt-1">Standard: 31 december</p>
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button
                onClick={handleCreateFiscalYear}
                disabled={loading}
                className="btn btn-primary"
              >
                Skapa
              </button>
              <button
                onClick={() => setShowCreateFiscalYear(false)}
                disabled={loading}
                className="btn btn-secondary"
              >
                Avbryt
              </button>
            </div>
          </div>
        )}

        {/* Fiscal Years List */}
        {fiscalYears.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <Calendar className="w-12 h-12 mx-auto mb-3 text-gray-400" />
            <p className="mb-4">Inga räkenskapsår konfigurerade.</p>
            <p className="text-sm">
              Skapa ett räkenskapsår för att kunna se verifikationer och rapporter per period.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {fiscalYears.map((fy) => (
              <div
                key={fy.id}
                className={`flex items-center justify-between p-3 border rounded-lg ${
                  fy.is_current ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                }`}
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900">{fy.label}</span>
                    {fy.is_current && (
                      <span className="px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-800 rounded">
                        Aktuellt
                      </span>
                    )}
                    {fy.is_closed && (
                      <span className="px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-800 rounded">
                        Stängt
                      </span>
                    )}
                    <span className="px-2 py-0.5 text-xs font-medium bg-gray-50 text-gray-600 rounded">
                      {accountCountsByFiscalYear[fy.id] || 0} konton
                    </span>
                  </div>
                  <div className="text-sm text-gray-600 mt-1">
                    {fy.start_date} till {fy.end_date}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleAssignVerifications(fy.id, fy.label)}
                    disabled={loading}
                    className="btn btn-secondary text-sm"
                  >
                    Tilldela verifikationer
                  </button>
                  <button
                    onClick={() => handleDeleteFiscalYear(fy.id, fy.label)}
                    disabled={loading}
                    className="p-2 text-red-600 hover:bg-red-50 rounded-md"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded">
          <p className="text-sm text-blue-800">
            <strong>Tips:</strong> Skapa räkenskapsår för varje år du har bokfört. Använd "Tilldela verifikationer" för att
            automatiskt koppla verifikationer till rätt år baserat på transaktionsdatum.
          </p>
        </div>
      </div>
        </div>
      )}

      {/* Templates Tab */}
      {activeTab === 'templates' && (
        <div>
          {/* Posting Templates Section */}
      <div className="card mb-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold">Konteringsmallar</h2>
          <button
            onClick={handleCreateTemplate}
            disabled={loading}
            className="btn btn-primary inline-flex items-center"
          >
            <Plus className="w-4 h-4 mr-2" />
            Skapa mall
          </button>
        </div>
        

        {templates.length > 0 ? (
          <div className="space-y-2">
            {[...templates]
              .sort((a: any, b: any) => (a.sort_order || 999) - (b.sort_order || 999))
              .map((template: any) => (
                <div key={template.id} className="relative">
                  {/* Drop indicator line BEFORE this template */}
                  {dropIndicator?.templateId === template.id && dropIndicator?.position === 'before' && (
                    <div className="absolute -top-1 left-0 right-0 h-0.5 bg-blue-500 rounded-full shadow-sm z-10" />
                  )}
                  
                  <div
                    draggable
                    onDragStart={(e) => handleDragStart(e, template)}
                    onDragEnd={handleDragEnd}
                    onDragOver={(e) => handleDragOver(e, template)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, template)}
                    className={`flex items-center justify-between p-3 border rounded-lg transition-all duration-200 cursor-move relative ${
                      draggedTemplate?.id === template.id 
                        ? 'bg-blue-50 border-blue-300 shadow-lg opacity-50' 
                        : 'bg-white hover:bg-gray-50 hover:shadow-sm border-gray-200'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="text-gray-400 hover:text-gray-600 cursor-grab active:cursor-grabbing"
                      >
                        <GripVertical className="w-4 h-4" />
                      </div>
                      <div>
                        <h3 className="font-medium">{template.name}</h3>
                        <p className="text-sm text-gray-500">{template.description}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleEditTemplate(template)}
                        className="text-blue-600 hover:text-blue-800 p-1 rounded"
                        title="Redigera mall (dra handtaget för att ändra ordning)"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button
                        onClick={async () => {
                          if (!selectedCompany || !confirm(`Är du säker på att du vill radera mallen "${template.name}"?`)) return

                          try {
                            await postingTemplateApi.delete(template.id)
                            setTemplates((prev: any) => prev.filter((t: any) => t.id !== template.id))
                            showToast('Mall raderad', 'success')
                          } catch (error: any) {
                            showToast('Kunde inte radera mall', 'error')
                          }
                        }}
                        className="text-red-600 hover:text-red-800 p-1 rounded"
                        title="Radera mall"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Drop indicator line AFTER this template */}
                  {dropIndicator?.templateId === template.id && dropIndicator?.position === 'after' && (
                    <div className="absolute -bottom-1 left-0 right-0 h-0.5 bg-blue-500 rounded-full shadow-sm z-10" />
                  )}
                </div>
              ))}
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500">
            <p className="mb-4">Inga konteringsmallar skapade ännu.</p>
            <button
              onClick={handleCreateTemplate}
              className="btn btn-primary"
            >
              Skapa din första mall
            </button>
          </div>
        )}

        <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded">
          <p className="text-sm text-blue-800">
            <strong>Tips:</strong> Skapa mallar för återkommande transaktioner som försäljning, inköp, eller lönutbetalningar.
            Använd formler som {'{amount * 0.25}'} för att automatiska beräkningar.
          </p>
        </div>
      </div>
        </div>
      )}

      {/* Template Modal */}
      {showCreateTemplate && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-6xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-lg font-semibold text-gray-900">
                  {editingTemplate ? 'Redigera mall' : 'Skapa ny mall'}
                </h3>
                <button
                  onClick={() => setShowCreateTemplate(false)}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Namn *
                  </label>
                  <input
                    type="text"
                    value={templateForm.name}
                    onChange={(e) => setTemplateForm(prev => ({ ...prev, name: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="t.ex. Inköp med 25% moms"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Beskrivning *
                  </label>
                  <input
                    type="text"
                    value={templateForm.description}
                    onChange={(e) => setTemplateForm(prev => ({ ...prev, description: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="t.ex. Försäljning med 25% moms"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Standard verifikationsserie
                  </label>
                  <input
                    type="text"
                    value={templateForm.default_series || ''}
                    onChange={(e) => setTemplateForm(prev => ({ ...prev, default_series: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="t.ex. A"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Standard verifikationstext
                  </label>
                  <input
                    type="text"
                    value={templateForm.default_journal_text || ''}
                    onChange={(e) => setTemplateForm(prev => ({ ...prev, default_journal_text: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    placeholder="t.ex. Försäljning"
                  />
                </div>
              </div>

              <div className="mb-6">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-md font-medium text-gray-900">Konteringsrader</h4>
                  <button
                    onClick={addTemplateLine}
                    className="inline-flex items-center px-3 py-2 text-sm font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                  >
                    <Plus className="w-4 h-4 mr-1" />
                    Lägg till rad
                  </button>
                </div>

                {templateForm.template_lines.length === 0 ? (
                  <div className="border-2 border-dashed border-gray-200 rounded-lg p-8 text-center">
                    <div className="text-gray-500 mb-2">
                      <Plus className="w-8 h-8 mx-auto mb-2 text-gray-400" />
                      Inga konteringsrader ännu
                    </div>
                    <p className="text-sm text-gray-500 mb-4">
                      Lägg till minst en konteringsrad för att skapa mallen
                    </p>
                    <button
                      onClick={addTemplateLine}
                      className="inline-flex items-center px-4 py-2 text-sm font-medium text-blue-600 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors"
                    >
                      <Plus className="w-4 h-4 mr-1" />
                      Lägg till första raden
                    </button>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-full border border-gray-200">
                      <thead className="bg-gray-50">
                        <tr>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 w-12">
                            #
                          </th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">
                            Konto *
                          </th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">
                            Formel *
                          </th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 hidden sm:table-cell">
                            Beskrivning
                          </th>
                          <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 w-16">
                            Åtgärd
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-200">
                        {templateForm.template_lines.map((line, index) => (
                          <tr key={index}>
                            <td className="px-4 py-2 text-sm font-medium text-gray-700">
                              {index + 1}
                            </td>
                            <td className="px-4 py-2">
                              <select
                                value={line.account_number}
                                onChange={(e) => updateTemplateLine(index, 'account_number', parseInt(e.target.value))}
                                className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                              >
                                <option value={0}>Välj konto...</option>
                                {allAccounts.map((account) => (
                                  <option key={account.account_number} value={account.account_number}>
                                    {account.account_number} - {account.name}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="px-4 py-2">
                              <input
                                type="text"
                                value={line.formula}
                                onChange={(e) => updateTemplateLine(index, 'formula', e.target.value)}
                                className="w-full px-2 py-1 border border-gray-300 rounded text-sm font-mono"
                                placeholder="{total}"
                              />
                            </td>
                            <td className="px-4 py-2 hidden sm:table-cell">
                              <input
                                type="text"
                                value={line.description || ''}
                                onChange={(e) => updateTemplateLine(index, 'description', e.target.value)}
                                className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
                                placeholder="Beskrivning..."
                              />
                            </td>
                            <td className="px-4 py-2 text-center">
                              {templateForm.template_lines.length > 1 && (
                                <button
                                  onClick={() => removeTemplateLine(index)}
                                  className="text-red-600 hover:text-red-800"
                                  title="Ta bort rad"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded">
                  <p className="text-sm text-blue-800">
                    <strong>Formel-tips:</strong> Använd <code>{'{total}'}</code> som variabel i formler. Exempel: <code>{'{total} * 0.25'}</code> för 25% moms, <code>{'{total} * -1'}</code> för negativt belopp, <code>{'100'}</code> för fast belopp.
                  </p>
                  <p className="text-sm text-blue-800 mt-2">
                    Positiva värden bokförs som <strong>debet</strong>, 
                    negativa värden som <strong>kredit</strong>.
                  </p>
                </div>
              </div>

              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowCreateTemplate(false)}
                  className="btn btn-secondary"
                  disabled={loading}
                >
                  Avbryt
                </button>
                <button
                  onClick={handleSaveTemplate}
                  disabled={loading}
                  className="btn btn-primary"
                >
                  {loading ? 'Sparar...' : (editingTemplate ? 'Uppdatera' : 'Skapa')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Layout Tab */}
      {activeTab === 'layout' && (
        <div>
          <div className="card mb-6">
            <div className="flex items-center gap-2 mb-4">
              <Layout className="w-5 h-5 text-gray-600" />
              <h2 className="text-xl font-semibold">Utseende</h2>
            </div>

            {/* Split View Settings */}
            <div className="mb-6">
              <h3 className="text-lg font-medium text-gray-900 mb-2">Delad vy</h3>
              <p className="text-gray-600 mb-4">
                Välj på vilken sida bilagor ska visas när du använder delad vy i verifikationer och fakturor.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl">
                <label className={`flex flex-col p-4 border-2 rounded-lg cursor-pointer transition-colors ${
                  layoutSettings.splitViewAttachmentSide === 'left'
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}>
                  <div className="flex items-start">
                    <input
                      type="radio"
                      name="splitViewAttachmentSide"
                      value="left"
                      checked={layoutSettings.splitViewAttachmentSide === 'left'}
                      onChange={() => updateLayoutSettings({ splitViewAttachmentSide: 'left' })}
                      className="mt-1 mr-3"
                    />
                    <div className="flex-1">
                      <div className="font-medium text-gray-900">Bilagor till vänster</div>
                      <div className="text-sm text-gray-600 mt-1">
                        Bilagan visas på vänster sida, formuläret på höger
                      </div>
                    </div>
                  </div>
                  {/* Visual diagram */}
                  <div className="mt-3 flex gap-1 h-12 rounded overflow-hidden border border-gray-300">
                    <div className={`flex-1 flex items-center justify-center text-xs font-medium ${
                      layoutSettings.splitViewAttachmentSide === 'left' ? 'bg-blue-200 text-blue-800' : 'bg-gray-200 text-gray-600'
                    }`}>
                      Bilaga
                    </div>
                    <div className={`flex-1 flex items-center justify-center text-xs font-medium ${
                      layoutSettings.splitViewAttachmentSide === 'left' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      Formulär
                    </div>
                  </div>
                </label>

                <label className={`flex flex-col p-4 border-2 rounded-lg cursor-pointer transition-colors ${
                  layoutSettings.splitViewAttachmentSide === 'right'
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}>
                  <div className="flex items-start">
                    <input
                      type="radio"
                      name="splitViewAttachmentSide"
                      value="right"
                      checked={layoutSettings.splitViewAttachmentSide === 'right'}
                      onChange={() => updateLayoutSettings({ splitViewAttachmentSide: 'right' })}
                      className="mt-1 mr-3"
                    />
                    <div className="flex-1">
                      <div className="font-medium text-gray-900">Bilagor till höger</div>
                      <div className="text-sm text-gray-600 mt-1">
                        Bilagan visas på höger sida, formuläret på vänster
                      </div>
                    </div>
                  </div>
                  {/* Visual diagram */}
                  <div className="mt-3 flex gap-1 h-12 rounded overflow-hidden border border-gray-300">
                    <div className={`flex-1 flex items-center justify-center text-xs font-medium ${
                      layoutSettings.splitViewAttachmentSide === 'right' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
                    }`}>
                      Formulär
                    </div>
                    <div className={`flex-1 flex items-center justify-center text-xs font-medium ${
                      layoutSettings.splitViewAttachmentSide === 'right' ? 'bg-blue-200 text-blue-800' : 'bg-gray-200 text-gray-600'
                    }`}>
                      Bilaga
                    </div>
                  </div>
                </label>
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded p-3">
              <p className="text-sm text-blue-800">
                <strong>Tips:</strong> Aktivera delad vy genom att klicka på pin-ikonen i verifikations- eller fakturaformuläret
                när du har en bilaga vald.
              </p>
            </div>
          </div>

          {/* Olänkade bilagor */}
          <div className="card">
            <div className="flex items-center gap-2 mb-4">
              <Paperclip className="w-5 h-5 text-gray-600" />
              <h2 className="text-xl font-semibold">Olänkade bilagor</h2>
            </div>

            <p className="text-gray-600 mb-4">
              Bilagor som inte är kopplade till någon verifikation, faktura eller utlägg kan tas bort här.
            </p>

            {loadingAttachments ? (
              <div className="flex items-center gap-2 text-gray-500">
                <Loader2 className="w-4 h-4 animate-spin" />
                Laddar bilagor...
              </div>
            ) : (
              <>
                {/* Statistik */}
                <div className="grid grid-cols-3 gap-4 mb-4">
                  <div className="bg-gray-50 p-3 rounded">
                    <div className="text-2xl font-bold">{attachments.length}</div>
                    <div className="text-sm text-gray-600">Totalt antal bilagor</div>
                  </div>
                  <div className="bg-gray-50 p-3 rounded">
                    <div className="text-2xl font-bold text-orange-600">
                      {attachments.filter(a => a.links?.length === 0).length}
                    </div>
                    <div className="text-sm text-gray-600">Olänkade</div>
                  </div>
                  <div className="bg-gray-50 p-3 rounded">
                    <div className="text-2xl font-bold">
                      {(attachments.reduce((sum, a) => sum + a.size_bytes, 0) / 1024 / 1024).toFixed(1)} MB
                    </div>
                    <div className="text-sm text-gray-600">Total storlek</div>
                  </div>
                </div>

                {/* Lista olänkade */}
                {attachments.filter(a => a.links?.length === 0).length === 0 ? (
                  <p className="text-green-600">Inga olänkade bilagor.</p>
                ) : (
                  <div className="border rounded divide-y max-h-64 overflow-y-auto">
                    {attachments
                      .filter(a => a.links?.length === 0)
                      .map((attachment, index) => (
                        <div key={attachment.id} className="flex items-center justify-between p-3 hover:bg-gray-50">
                          <div
                            className="flex-1 min-w-0 cursor-pointer"
                            onClick={() => openPreview(index)}
                          >
                            <div className="font-medium truncate text-blue-600 hover:text-blue-800">{attachment.original_filename}</div>
                            <div className="text-sm text-gray-500">
                              {(attachment.size_bytes / 1024).toFixed(0)} KB
                              {' · '}
                              {new Date(attachment.created_at).toLocaleDateString('sv-SE')}
                            </div>
                          </div>
                          <button
                            onClick={() => handleDeleteAttachment(attachment.id)}
                            disabled={deletingAttachment === attachment.id}
                            className="btn btn-danger btn-sm flex items-center gap-1 ml-3"
                          >
                            {deletingAttachment === attachment.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Trash2 className="w-4 h-4" />
                            )}
                            Radera
                          </button>
                        </div>
                      ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {floatingPreview}

      {/* Delete Backup Confirmation Modal */}
      {backupToDelete && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 overflow-hidden">
            <div className="bg-gradient-to-r from-red-500 to-red-600 px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="bg-white bg-opacity-20 p-2 rounded-full">
                  <Trash2 className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-xl font-semibold text-white">Radera backup</h3>
              </div>
            </div>
            <div className="px-6 py-5">
              <p className="text-gray-700 mb-3">
                Är du säker på att du vill radera följande backup?
              </p>
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <p className="font-mono text-sm text-gray-900">{backupToDelete}</p>
              </div>
              <p className="text-sm text-red-600 mt-3">
                Denna åtgärd kan inte ångras.
              </p>
            </div>
            <div className="bg-gray-50 px-6 py-4 flex gap-3 justify-end">
              <button
                onClick={() => setBackupToDelete(null)}
                disabled={!!deletingBackup}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors disabled:opacity-50"
              >
                Avbryt
              </button>
              <button
                onClick={handleDeleteBackup}
                disabled={!!deletingBackup}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 border border-transparent rounded-lg hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {deletingBackup ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Raderar...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    Radera
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI Settings Tab */}
      {activeTab === 'ai' && user?.is_admin && (
        <div>
          {aiLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : (
            <>
              {/* Toggle card */}
              <div className={`rounded-xl border-2 p-5 mb-6 ${
                aiForm.ai_enabled
                  ? 'border-primary-200 bg-primary-50/50'
                  : 'border-gray-200 bg-gray-50'
              }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                      aiForm.ai_enabled ? 'bg-primary-100' : 'bg-gray-200'
                    }`}>
                      <Bot className={`w-5 h-5 ${aiForm.ai_enabled ? 'text-primary-600' : 'text-gray-500'}`} />
                    </div>
                    <div>
                      <h2 className="text-base font-semibold text-gray-900">
                        AI-assistent {aiForm.ai_enabled ? 'aktiverad' : 'inaktiverad'}
                      </h2>
                      <p className="text-sm text-gray-500">
                        {aiForm.ai_enabled
                          ? 'Chattassistenten är synlig för alla användare i företaget'
                          : 'Slå på för att göra chattassistenten tillgänglig'}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => setAiForm({ ...aiForm, ai_enabled: !aiForm.ai_enabled })}
                    className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors flex-shrink-0 ${
                      aiForm.ai_enabled ? 'bg-primary-600' : 'bg-gray-300'
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                        aiForm.ai_enabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* Connection settings */}
              <div className="card mb-6">
                <h3 className="text-sm font-semibold text-gray-700 mb-4 uppercase tracking-wide">Anslutning</h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Ollama-adress</label>
                    <input
                      type="text"
                      value={aiForm.ollama_url}
                      onChange={(e) => setAiForm({ ...aiForm, ollama_url: e.target.value })}
                      className="input w-full"
                      placeholder="http://host.docker.internal:11434"
                    />
                    <p className="text-xs text-gray-400 mt-1">
                      URL:en till Ollama-servern som kör AI-modellen
                    </p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Modell</label>
                    {aiModels.length > 0 ? (
                      <select
                        value={aiForm.ollama_model}
                        onChange={(e) => setAiForm({ ...aiForm, ollama_model: e.target.value })}
                        className="input w-full"
                      >
                        <option value="">Välj modell...</option>
                        {aiModels.map((model) => (
                          <option key={model.name} value={model.name}>
                            {model.name}
                            {model.parameter_size ? ` — ${model.parameter_size}` : ''}
                            {model.quantization_level ? ` (${model.quantization_level})` : ''}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={aiForm.ollama_model}
                        onChange={(e) => setAiForm({ ...aiForm, ollama_model: e.target.value })}
                        className="input w-full"
                        placeholder="llama3.1:8b"
                      />
                    )}
                    <p className="text-xs text-gray-400 mt-1">
                      {aiModels.length > 0
                        ? 'Välj bland installerade modeller'
                        : 'Ange modellnamn eller testa anslutningen för att se tillgängliga modeller'}
                    </p>
                  </div>
                </div>

                {/* Test connection button + result */}
                <div className="flex items-center gap-3 pt-3 border-t border-gray-100">
                  <button
                    onClick={testAiConnection}
                    disabled={aiTesting || !aiForm.ollama_url}
                    className="btn btn-outline-primary flex items-center gap-2 text-sm"
                  >
                    {aiTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    Testa anslutning
                  </button>
                  {aiHealth && !aiTesting && (
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        aiHealth.reachable
                          ? aiHealth.model_available ? 'bg-green-500' : 'bg-yellow-500'
                          : 'bg-red-500'
                      }`} />
                      <span className="text-sm text-gray-600">
                        {aiHealth.reachable
                          ? aiHealth.model_available
                            ? `Redo — ${aiHealth.model_name} svarar`
                            : `Ollama ansluten men modellen svarar inte${aiHealth.error ? ` (${aiHealth.error})` : ''}`
                          : `Kan inte nå Ollama${aiHealth.error ? ` — ${aiHealth.error}` : ''}`
                        }
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Behavior settings */}
              <div className="card mb-6">
                <h3 className="text-sm font-semibold text-gray-700 mb-4 uppercase tracking-wide">Beteende</h3>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Extra instruktioner</label>
                  <textarea
                    value={aiForm.system_prompt}
                    onChange={(e) => setAiForm({ ...aiForm, system_prompt: e.target.value })}
                    className="input w-full min-h-[140px]"
                    rows={6}
                    placeholder={'Exempel:\n- Använd alltid konto 6212 för mobiltelefoni\n- Vår standard-momssats är 25%\n- Föreslå aldrig konto 2990'}
                  />
                  <p className="text-xs text-gray-400 mt-1">
                    Egna regler som komplettar de inbyggda bokföringsinstruktionerna. Lämna tomt för standardbeteende.
                  </p>
                </div>
              </div>

              {/* Save */}
              <div className="flex justify-end">
                <button
                  onClick={saveAiSettings}
                  disabled={aiSaving}
                  className="btn btn-primary flex items-center gap-2"
                >
                  {aiSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Spara inställningar
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Restore Modal */}
      <RestoreModal
        isOpen={showRestoreModal}
        onClose={() => setShowRestoreModal(false)}
        backups={backups}
      />

      {/* SIE4 Import Modal */}
      {selectedCompany && (
        <SIE4ImportModal
          isOpen={showSIE4ImportModal}
          onClose={() => setShowSIE4ImportModal(false)}
          companyId={selectedCompany.id}
          onSuccess={loadData}
        />
      )}

    </div>
  )
}
