import axios from 'axios'
import type {
  Company,
  FiscalYear,
  Account,
  Verification,
  VerificationListItem,
  PostingTemplate,
  TemplateExecutionRequest,
  TemplateExecutionResult,
  BalanceSheet,
  IncomeStatement,
  GeneralLedger,
  Customer,
  Supplier,
  Invoice,
  InvoiceListItem,
  InvoiceCreateData,
  SupplierInvoice,
  SupplierInvoiceListItem,
  SupplierInvoiceCreateData,
  DefaultAccount,
  SIE4PreviewResponse,
  SIE4ImportResponse,
  VATReport,
  VATPeriodsResponse,
  Expense,
  ExpenseCreateData,
  MonthlyStatistics,
  Attachment,
  EntityAttachment,
  AttachmentRole,
  BackupInfo,
  RestoreResponse,
  BackupScheduleResponse,
  BackupScheduleUpdate,
  AISettings,
  AISettingsUpdate,
  OllamaModel,
  OllamaHealth,
  ChatSession,
  ChatSessionDetail,
  AIUpload,
} from '@/types'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api'

const api = axios.create({
  baseURL: API_BASE_URL,
})

// Add auth token to all requests
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('auth_token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// Handle 401 unauthorized responses
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Token is invalid or expired, clear it
      localStorage.removeItem('auth_token')
      // Redirect to login if not already there
      if (window.location.pathname !== '/login') {
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  }
)

// Companies
export const companyApi = {
  list: () => api.get<Company[]>('/companies/'),
  get: (id: number) => api.get<Company>(`/companies/${id}`),
  create: (data: Omit<Company, 'id'>) => api.post<Company>('/companies/', data),
  update: (id: number, data: Partial<Company>) => api.patch<Company>(`/companies/${id}`, data),
  delete: (id: number) => api.delete(`/companies/${id}`),
  initializeDefaults: (id: number, fiscalYearId?: number) =>
    api.post<{ message: string; default_accounts_configured: number }>(
      `/companies/${id}/initialize-defaults`,
      null,
      fiscalYearId ? { params: { fiscal_year_id: fiscalYearId } } : undefined
    ),
  getBasAccounts: () => api.get<{ version: string; description: string; accounts: unknown[] }>('/companies/bas-accounts'),
  seedBas: (id: number, fiscalYearId: number) =>
    api.post(`/companies/${id}/seed-bas`, null, { params: { fiscal_year_id: fiscalYearId } }),
  seedTemplates: (id: number) => api.post(`/companies/${id}/seed-templates`),
  uploadLogo: (id: number, file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return api.post<Company>(`/companies/${id}/logo`, formData)
  },
  getLogo: (id: number) => api.get(`/companies/${id}/logo`, { responseType: 'blob' }),
  deleteLogo: (id: number) => api.delete<Company>(`/companies/${id}/logo`),
}

// Fiscal Years
export const fiscalYearApi = {
  list: (companyId: number) => api.get<FiscalYear[]>('/fiscal-years/', { params: { company_id: companyId } }),
  get: (id: number) => api.get<FiscalYear>(`/fiscal-years/${id}`),
  getCurrent: (companyId: number) => api.get<FiscalYear | null>(`/fiscal-years/current/by-company/${companyId}`),
  create: (data: Omit<FiscalYear, 'id' | 'is_current'>) => api.post<FiscalYear>('/fiscal-years/', data),
  update: (id: number, data: Partial<FiscalYear>) => api.patch<FiscalYear>(`/fiscal-years/${id}`, data),
  delete: (id: number) => api.delete(`/fiscal-years/${id}`),
  assignVerifications: (id: number) => api.post<{ message: string; verifications_assigned: number }>(`/fiscal-years/${id}/assign-verifications`),
  copyChartOfAccounts: (fiscalYearId: number, sourceFiscalYearId?: number) =>
    api.post<{
      message: string;
      source_fiscal_year_id: number;
      source_fiscal_year_label: string;
      target_fiscal_year_id: number;
      target_fiscal_year_label: string;
      accounts_copied: number;
    }>(`/fiscal-years/${fiscalYearId}/copy-chart-of-accounts`, null, {
      params: sourceFiscalYearId ? { source_fiscal_year_id: sourceFiscalYearId } : undefined,
    }),
}

// Accounts
export const accountApi = {
  list: (companyId: number, fiscalYearId: number, params?: { account_type?: string; active_only?: boolean }) =>
    api.get<Account[]>('/accounts/', { params: { company_id: companyId, fiscal_year_id: fiscalYearId, ...params } }),
  get: (id: number) => api.get<Account>(`/accounts/${id}`),
  create: (data: Omit<Account, 'id' | 'current_balance'>) =>
    api.post<Account>('/accounts/', data),
  update: (id: number, data: Partial<Account>) => api.patch<Account>(`/accounts/${id}`, data),
  delete: (id: number) => api.delete(`/accounts/${id}`),
  getLedger: (accountId: number, params?: { fiscal_year_id?: number; start_date?: string; end_date?: string }) =>
    api.get(`/accounts/${accountId}/ledger`, { params }),
}

// Verifications
export const verificationApi = {
  list: (
    companyId: number,
    params?: {
      fiscal_year_id?: number
      start_date?: string
      end_date?: string
      series?: string
      limit?: number
      offset?: number
    }
  ) =>
    api.get<VerificationListItem[]>('/verifications/', {
      params: { company_id: companyId, ...params },
    }),
  get: (id: number) => api.get<Verification>(`/verifications/${id}`),
  create: (data: Omit<Verification, 'id'>) => api.post<Verification>('/verifications/', data),
  update: (id: number, data: Partial<Verification>) =>
    api.patch<Verification>(`/verifications/${id}`, data),
  delete: (id: number) => api.delete(`/verifications/${id}`),
  // Attachment link methods
  listAttachments: (id: number) => api.get<EntityAttachment[]>(`/verifications/${id}/attachments`),
  linkAttachment: (id: number, attachmentId: number, role?: AttachmentRole) =>
    api.post<EntityAttachment>(`/verifications/${id}/attachments`, {
      attachment_id: attachmentId,
      role: role || 'supporting',
    }),
  unlinkAttachment: (id: number, attachmentId: number) =>
    api.delete(`/verifications/${id}/attachments/${attachmentId}`),
}

// Posting Templates
export const postingTemplateApi = {
  list: (companyId: number, params?: { skip?: number; limit?: number }) =>
    api.get<PostingTemplate[]>('/posting-templates/', {
      params: { company_id: companyId, ...params },
    }),
  get: (id: number) => api.get<PostingTemplate>(`/posting-templates/${id}`),
  create: (data: Omit<PostingTemplate, 'id' | 'created_at' | 'updated_at'>) =>
    api.post<PostingTemplate>('/posting-templates/', data),
  update: (id: number, data: Partial<PostingTemplate>) =>
    api.put<PostingTemplate>(`/posting-templates/${id}`, data),
  delete: (id: number) => api.delete(`/posting-templates/${id}`),
  execute: (id: number, request: TemplateExecutionRequest) =>
    api.post<TemplateExecutionResult>(`/posting-templates/${id}/execute`, request),
  reorder: (companyId: number, templateOrders: { id: number; sort_order: number }[]) =>
    api.patch(`/posting-templates/reorder?company_id=${companyId}`, templateOrders),
}

// Reports
export const reportApi = {
  balanceSheet: (companyId: number, fiscalYearId?: number) =>
    api.get<BalanceSheet>('/reports/balance-sheet', { params: { company_id: companyId, fiscal_year_id: fiscalYearId } }),
  incomeStatement: (companyId: number, fiscalYearId?: number) =>
    api.get<IncomeStatement>('/reports/income-statement', {
      params: { company_id: companyId, fiscal_year_id: fiscalYearId },
    }),
  generalLedger: (companyId: number, fiscalYearId?: number, startDate?: string, endDate?: string, accountNumbers?: string) =>
    api.get<GeneralLedger>('/reports/general-ledger', {
      params: {
        company_id: companyId,
        fiscal_year_id: fiscalYearId,
        start_date: startDate,
        end_date: endDate,
        account_numbers: accountNumbers,
      },
    }),
  vatReport: (companyId: number, fiscalYearId?: number, startDate?: string, endDate?: string, excludeVatSettlements?: boolean) =>
    api.get<VATReport>('/reports/vat-report', {
      params: {
        company_id: companyId,
        fiscal_year_id: fiscalYearId,
        start_date: startDate,
        end_date: endDate,
        exclude_vat_settlements: excludeVatSettlements,
      },
    }),
  vatPeriods: (companyId: number, year: number) =>
    api.get<VATPeriodsResponse>('/reports/vat-periods', {
      params: { company_id: companyId, year },
    }),
  monthlyStatistics: (companyId: number, fiscalYearId: number, year: number) =>
    api.get<MonthlyStatistics>('/reports/monthly-statistics', {
      params: { company_id: companyId, fiscal_year_id: fiscalYearId, year },
    }),
  balanceSheetPdf: (companyId: number, fiscalYearId: number) =>
    api.get('/reports/balance-sheet', {
      params: { company_id: companyId, fiscal_year_id: fiscalYearId, format: 'pdf' },
      responseType: 'blob',
    }),
  incomeStatementPdf: (companyId: number, fiscalYearId: number) =>
    api.get('/reports/income-statement', {
      params: { company_id: companyId, fiscal_year_id: fiscalYearId, format: 'pdf' },
      responseType: 'blob',
    }),
  generalLedgerPdf: (companyId: number, fiscalYearId: number) =>
    api.get('/reports/general-ledger', {
      params: { company_id: companyId, fiscal_year_id: fiscalYearId, format: 'pdf' },
      responseType: 'blob',
    }),
}

// Customers
export const customerApi = {
  list: (companyId: number, activeOnly = true) =>
    api.get<Customer[]>('/customers/', { params: { company_id: companyId, active_only: activeOnly } }),
  get: (id: number) => api.get<Customer>(`/customers/${id}`),
  create: (data: Omit<Customer, 'id' | 'active'>) => api.post<Customer>('/customers/', data),
  update: (id: number, data: Partial<Customer>) => api.patch<Customer>(`/customers/${id}`, data),
  delete: (id: number) => api.delete(`/customers/${id}`),
}

// Suppliers
export const supplierApi = {
  list: (companyId: number, activeOnly = true) =>
    api.get<Supplier[]>('/suppliers/', { params: { company_id: companyId, active_only: activeOnly } }),
  get: (id: number) => api.get<Supplier>(`/suppliers/${id}`),
  create: (data: Omit<Supplier, 'id' | 'active'>) => api.post<Supplier>('/suppliers/', data),
  update: (id: number, data: Partial<Supplier>) => api.patch<Supplier>(`/suppliers/${id}`, data),
  delete: (id: number) => api.delete(`/suppliers/${id}`),
}

// Invoices (Outgoing)
export const invoiceApi = {
  list: (companyId: number, params?: { customer_id?: number; status?: string; fiscal_year_id?: number }) =>
    api.get<InvoiceListItem[]>('/invoices/', { params: { company_id: companyId, ...params } }),
  get: (id: number) => api.get<Invoice>(`/invoices/${id}`),
  create: (data: InvoiceCreateData) => api.post<Invoice>('/invoices/', data),
  update: (id: number, data: Partial<Invoice>) => api.patch<Invoice>(`/invoices/${id}`, data),
  send: (id: number) => api.post<Invoice>(`/invoices/${id}/send`),
  markPaid: (id: number, data: { paid_date: string; paid_amount?: number; bank_account_id?: number }) =>
    api.post<Invoice>(`/invoices/${id}/mark-paid`, data),
  cancel: (id: number) => api.post<Invoice>(`/invoices/${id}/cancel`),
  delete: (id: number) => api.delete(`/invoices/${id}`),
}

// Supplier Invoices (Incoming)
export const supplierInvoiceApi = {
  list: (companyId: number, params?: { supplier_id?: number; status?: string; fiscal_year_id?: number }) =>
    api.get<SupplierInvoiceListItem[]>('/supplier-invoices/', { params: { company_id: companyId, ...params } }),
  get: (id: number) => api.get<SupplierInvoice>(`/supplier-invoices/${id}`),
  create: (data: SupplierInvoiceCreateData) => api.post<SupplierInvoice>('/supplier-invoices/', data),
  update: (id: number, data: Partial<SupplierInvoice>) =>
    api.patch<SupplierInvoice>(`/supplier-invoices/${id}`, data),
  register: (id: number) => api.post<SupplierInvoice>(`/supplier-invoices/${id}/register`),
  markPaid: (id: number, data: { paid_date: string; paid_amount?: number; bank_account_id?: number }) =>
    api.post<SupplierInvoice>(`/supplier-invoices/${id}/mark-paid`, data),
  cancel: (id: number) => api.post<SupplierInvoice>(`/supplier-invoices/${id}/cancel`),
  delete: (id: number) => api.delete(`/supplier-invoices/${id}`),
  // Attachment link methods (new unified attachment system)
  listAttachments: (id: number) => api.get<EntityAttachment[]>(`/supplier-invoices/${id}/attachments`),
  linkAttachment: (id: number, attachmentId: number, role?: AttachmentRole) =>
    api.post<EntityAttachment>(`/supplier-invoices/${id}/attachments`, {
      attachment_id: attachmentId,
      role: role || 'original',
    }),
  unlinkAttachment: (id: number, attachmentId: number) =>
    api.delete(`/supplier-invoices/${id}/attachments/${attachmentId}`),
}

// Attachments (Unified attachment system)
export const attachmentApi = {
  upload: (companyId: number, file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return api.post<Attachment>('/attachments/', formData, {
      params: { company_id: companyId },
    })
  },
  get: (id: number) => api.get<Attachment>(`/attachments/${id}`),
  download: (id: number) => api.get(`/attachments/${id}/content`, { responseType: 'blob' }),
  delete: (id: number) => api.delete(`/attachments/${id}`),
  list: (companyId: number) => api.get<Attachment[]>('/attachments/', { params: { company_id: companyId } }),
}

// SIE4 Import/Export
export const sie4Api = {
  preview: (companyId: number, file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return api.post<SIE4PreviewResponse>(`/sie4/preview/${companyId}`, formData)
  },
  import: (companyId: number, file: File, fiscalYearId?: number) => {
    const formData = new FormData()
    formData.append('file', file)
    return api.post<SIE4ImportResponse>(`/sie4/import/${companyId}`, formData, {
      params: fiscalYearId ? { fiscal_year_id: fiscalYearId } : undefined,
    })
  },
  export: (companyId: number, fiscalYearId: number, includeVerifications: boolean = true) => {
    return api.get(`/sie4/export/${companyId}`, {
      params: { fiscal_year_id: fiscalYearId, include_verifications: includeVerifications },
      responseType: 'blob',
    })
  },
}

// Default Accounts
export const defaultAccountApi = {
  list: (companyId: number) =>
    api.get<DefaultAccount[]>('/default-accounts/', { params: { company_id: companyId } }),
  create: (data: { company_id: number; account_type: string; account_id: number }) =>
    api.post<DefaultAccount>('/default-accounts/', data),
  update: (defaultAccountId: number, data: { account_id: number }) =>
    api.patch<DefaultAccount>(`/default-accounts/${defaultAccountId}`, data),
  delete: (defaultAccountId: number) =>
    api.delete(`/default-accounts/${defaultAccountId}`),
}

// Expenses
export const expenseApi = {
  list: (companyId: number, params?: { status_filter?: string; employee_name?: string; start_date?: string; end_date?: string }) =>
    api.get<Expense[]>('/expenses/', { params: { company_id: companyId, ...params } }),
  get: (id: number) => api.get<Expense>(`/expenses/${id}`),
  create: (data: ExpenseCreateData) => api.post<Expense>('/expenses/', data),
  update: (id: number, data: Partial<Expense>) => api.patch<Expense>(`/expenses/${id}`, data),
  delete: (id: number) => api.delete(`/expenses/${id}`),
  submit: (id: number) => api.post<Expense>(`/expenses/${id}/submit`),
  approve: (id: number) => api.post<Expense>(`/expenses/${id}/approve`),
  reject: (id: number) => api.post<Expense>(`/expenses/${id}/reject`),
  book: (id: number, employeePayableAccountId: number) =>
    api.post<Expense>(`/expenses/${id}/book`, null, { params: { employee_payable_account_id: employeePayableAccountId } }),
  markPaid: (id: number, paidDate: string, bankAccountId: number) =>
    api.post<Expense>(`/expenses/${id}/mark-paid`, null, { params: { paid_date: paidDate, bank_account_id: bankAccountId } }),
  // Attachment link methods (new unified attachment system)
  listAttachments: (id: number) => api.get<EntityAttachment[]>(`/expenses/${id}/attachments`),
  linkAttachment: (id: number, attachmentId: number, role?: AttachmentRole) =>
    api.post<EntityAttachment>(`/expenses/${id}/attachments`, {
      attachment_id: attachmentId,
      role: role || 'receipt',
    }),
  unlinkAttachment: (id: number, attachmentId: number) =>
    api.delete(`/expenses/${id}/attachments/${attachmentId}`),
}

// Backup & Restore
// Longer timeout for backup/restore operations (10 minutes)
const BACKUP_TIMEOUT = 10 * 60 * 1000

export const backupApi = {
  list: () => api.get<BackupInfo[]>('/backup/list'),

  create: () => api.post<BackupInfo>('/backup/create', null, {
    timeout: BACKUP_TIMEOUT,
  }),

  download: (filename: string) =>
    api.get(`/backup/download/${filename}`, { responseType: 'blob' }),

  delete: (filename: string) =>
    api.delete(`/backup/${filename}`),

  restoreFromServer: (filename: string) =>
    api.post<RestoreResponse>(`/backup/restore/${filename}`, null, {
      timeout: BACKUP_TIMEOUT,
    }),

  restoreFromUpload: (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return api.post<RestoreResponse>('/backup/restore', formData, {
      timeout: BACKUP_TIMEOUT,
    })
  },

  getSchedule: () => api.get<BackupScheduleResponse>('/backup/schedule'),

  updateSchedule: (data: BackupScheduleUpdate) =>
    api.put<BackupScheduleResponse>('/backup/schedule', data),
}

// AI Assistant
export const aiApi = {
  getHealth: () => api.get<OllamaHealth>('/ai/health'),
  getSettings: () => api.get<AISettings>('/ai/settings'),
  updateSettings: (data: AISettingsUpdate) => api.put<AISettings>('/ai/settings', data),
  listModels: () => api.get<OllamaModel[]>('/ai/models'),
  listSessions: (companyId: number) =>
    api.get<ChatSession[]>('/ai/sessions', { params: { company_id: companyId } }),
  getSession: (sessionId: number) => api.get<ChatSessionDetail>(`/ai/sessions/${sessionId}`),
  deleteSession: (sessionId: number) => api.delete(`/ai/sessions/${sessionId}`),
  uploadFile: (companyId: number, file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return api.post<AIUpload>('/ai/chat/upload', formData, {
      params: { company_id: companyId },
    })
  },
  getUploadUrl: (uploadId: number) => `${API_BASE_URL}/ai/uploads/${uploadId}`,
  copyToAttachment: (uploadId: number) =>
    api.post<Attachment>(`/ai/uploads/${uploadId}/to-attachment`),
}

export default api
