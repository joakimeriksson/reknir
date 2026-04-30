// Swedish bookkeeping types

export enum AccountType {
  ASSET = 'asset',
  EQUITY_LIABILITY = 'equity_liability',
  REVENUE = 'revenue',
  COST_GOODS = 'cost_goods',
  COST_LOCAL = 'cost_local',
  COST_OTHER = 'cost_other',
  COST_PERSONNEL = 'cost_personnel',
  COST_MISC = 'cost_misc',
}

export enum AccountingBasis {
  ACCRUAL = 'accrual',
  CASH = 'cash',
}

export enum VATReportingPeriod {
  MONTHLY = 'monthly',
  QUARTERLY = 'quarterly',
  YEARLY = 'yearly',
}

export enum PaymentType {
  BANKGIRO = 'bankgiro',
  PLUSGIRO = 'plusgiro',
  BANK_ACCOUNT = 'bank_account',
}

export interface Company {
  id: number
  name: string
  org_number: string
  vat_number: string
  address?: string
  postal_code?: string
  city?: string
  phone?: string
  email?: string
  fiscal_year_start: string
  fiscal_year_end: string
  accounting_basis: AccountingBasis
  vat_reporting_period: VATReportingPeriod
  is_vat_registered: boolean
  logo_filename?: string
  payment_type?: PaymentType | null
  bankgiro_number?: string | null
  plusgiro_number?: string | null
  clearing_number?: string | null
  account_number?: string | null
  iban?: string | null
  bic?: string | null
}

export interface FiscalYear {
  id: number
  company_id: number
  year: number
  label: string
  start_date: string
  end_date: string
  is_closed: boolean
  is_current: boolean
}

export interface Account {
  id: number
  company_id: number
  fiscal_year_id: number
  account_number: number
  name: string
  description?: string
  account_type: AccountType
  opening_balance: number
  current_balance: number
  active: boolean
  is_bas_account: boolean
}

export interface TransactionLine {
  id?: number
  verification_id?: number
  account_id: number
  account_number?: number
  account_name?: string
  debit: number
  credit: number
  description?: string
}

export interface Verification {
  id?: number
  company_id: number
  verification_number?: number
  series: string
  transaction_date: string
  registration_date?: string
  description: string
  locked?: boolean
  created_at?: string
  updated_at?: string
  transaction_lines: TransactionLine[]
  is_balanced?: boolean
  total_amount?: number
}

export interface VerificationListItem {
  id: number
  verification_number: number
  series: string
  transaction_date: string
  description: string
  total_amount: number
  locked: boolean
  attachment_count: number
}

// Posting Templates
export interface PostingTemplateLine {
  id?: number
  template_id?: number
  account_number: number
  formula: string
  description?: string
  sort_order: number
}

export interface PostingTemplate {
  id?: number
  company_id: number
  name: string
  description: string
  default_series?: string
  default_journal_text?: string
  created_at?: string
  updated_at?: string
  template_lines: PostingTemplateLine[]
}

export interface PostingTemplateListItem {
  id: number
  name: string
  description: string
  default_series?: string
  created_at: string
  updated_at: string
  line_count: number
  sort_order?: number
}

export interface TemplateExecutionRequest {
  amount: number
  fiscal_year_id: number
  transaction_date?: string
  description_override?: string
}

export interface TemplateExecutionLine {
  account_id: number
  debit: number
  credit: number
  description?: string
}

export interface TemplateExecutionResult {
  template_id: number
  template_name: string
  amount: number
  posting_lines: TemplateExecutionLine[]
  total_debit: number
  total_credit: number
  is_balanced: boolean
}

export interface BalanceSheet {
  company_id: number
  report_type: string
  assets: {
    accounts: Array<{ account_number: number; name: string; balance: number }>
    total: number
  }
  liabilities: {
    accounts: Array<{ account_number: number; name: string; balance: number }>
    total: number
  }
  equity: {
    accounts: Array<{ account_number: number; name: string; balance: number }>
    total: number
  }
  current_year_result: number
  total_liabilities_and_equity: number
  balanced: boolean
}

export interface IncomeStatement {
  company_id: number
  report_type: string
  revenue: {
    accounts: Array<{ account_number: number; name: string; balance: number }>
    total: number
  }
  expenses: {
    accounts: Array<{ account_number: number; name: string; balance: number }>
    total: number
  }
  profit_loss: number
}

export interface GeneralLedgerAccountSummary {
  account_id: number
  account_number: number
  account_name: string
  opening_balance: number
  period_debit: number
  period_credit: number
  closing_balance: number
  transaction_count: number
}

export interface GeneralLedger {
  company_id: number
  report_type: string
  start_date: string
  end_date: string
  accounts: GeneralLedgerAccountSummary[]
  account_count: number
}

// Invoice management types

export enum InvoiceStatus {
  DRAFT = 'draft',
  ISSUED = 'issued',
  CANCELLED = 'cancelled',
}

export enum PaymentStatus {
  UNPAID = 'unpaid',
  PARTIALLY_PAID = 'partially_paid',
  PAID = 'paid',
}

export interface Customer {
  id: number
  company_id: number
  name: string
  org_number?: string
  contact_person?: string
  email?: string
  phone?: string
  address?: string
  postal_code?: string
  city?: string
  country: string
  payment_terms_days: number
  active: boolean
}

export interface Supplier {
  id: number
  company_id: number
  name: string
  org_number?: string
  contact_person?: string
  email?: string
  phone?: string
  address?: string
  postal_code?: string
  city?: string
  country: string
  payment_terms_days: number
  bank_account?: string
  bank_name?: string
  active: boolean
}

export interface InvoiceLine {
  id?: number
  invoice_id?: number
  description: string
  quantity: number
  unit: string
  unit_price: number
  vat_rate: number
  account_id?: number
  net_amount?: number
  vat_amount?: number
  total_amount?: number
}

export interface InvoiceCreateData {
  company_id: number
  customer_id: number
  invoice_date: string
  due_date: string
  reference?: string
  our_reference?: string
  notes?: string
  message?: string
  invoice_series?: string
  invoice_lines: Omit<InvoiceLine, 'id' | 'invoice_id' | 'net_amount' | 'vat_amount' | 'total_amount'>[]
}

export interface SupplierInvoiceCreateData {
  company_id: number
  supplier_id: number
  supplier_invoice_number: string
  invoice_date: string
  due_date: string
  ocr_number?: string
  reference?: string
  notes?: string
  supplier_invoice_lines: Omit<InvoiceLine, 'id' | 'invoice_id' | 'net_amount' | 'vat_amount' | 'total_amount'>[]
}

export interface ExpenseCreateData {
  company_id: number
  employee_name: string
  expense_date: string
  description: string
  amount: number
  vat_amount: number
  expense_account_id?: number | null
  vat_account_id?: number | null
}

export interface InvoicePayment {
  id: number
  invoice_id: number
  payment_date: string
  amount: number
  verification_id?: number
  bank_account_id?: number
  reference?: string
  notes?: string
  created_at: string
}

export interface SupplierInvoicePayment {
  id: number
  supplier_invoice_id: number
  payment_date: string
  amount: number
  verification_id?: number
  bank_account_id?: number
  reference?: string
  notes?: string
  created_at: string
}

export interface Invoice {
  id: number
  company_id: number
  customer_id: number
  invoice_number: number
  invoice_series: string
  invoice_date: string
  due_date: string
  paid_date?: string
  reference?: string
  our_reference?: string
  total_amount: number
  vat_amount: number
  net_amount: number
  status: InvoiceStatus
  payment_status: PaymentStatus
  paid_amount: number
  notes?: string
  message?: string
  invoice_verification_id?: number
  payment_verification_id?: number
  pdf_path?: string
  payment_type?: PaymentType
  bankgiro_number?: string
  plusgiro_number?: string
  clearing_number?: string
  account_number?: string
  iban?: string
  bic?: string
  created_at: string
  updated_at: string
  sent_at?: string
  invoice_lines: InvoiceLine[]
  payments?: InvoicePayment[]
}

export interface InvoiceListItem {
  id: number
  invoice_number: number
  invoice_series: string
  invoice_date: string
  due_date: string
  customer_id: number
  customer_name: string
  total_amount: number
  status: InvoiceStatus
  payment_status: PaymentStatus
  paid_amount: number
}

export interface SupplierInvoice {
  id: number
  company_id: number
  supplier_id: number
  supplier_invoice_number: string
  our_invoice_number?: number
  invoice_date: string
  due_date: string
  paid_date?: string
  total_amount: number
  vat_amount: number
  net_amount: number
  status: InvoiceStatus
  payment_status: PaymentStatus
  paid_amount: number
  ocr_number?: string
  reference?: string
  notes?: string
  invoice_verification_id?: number
  payment_verification_id?: number
  created_at: string
  updated_at: string
  supplier_invoice_lines: InvoiceLine[]
  payments?: SupplierInvoicePayment[]
}

export interface SupplierInvoiceListItem {
  id: number
  our_invoice_number?: number
  supplier_invoice_number: string
  invoice_date: string
  due_date: string
  supplier_id: number
  supplier_name: string
  total_amount: number
  status: InvoiceStatus
  payment_status: PaymentStatus
  paid_amount: number
}

// Default Accounts & SIE4

export enum DefaultAccountType {
  REVENUE_25 = 'revenue_25',
  REVENUE_12 = 'revenue_12',
  REVENUE_6 = 'revenue_6',
  REVENUE_0 = 'revenue_0',
  VAT_OUTGOING_25 = 'vat_outgoing_25',
  VAT_OUTGOING_12 = 'vat_outgoing_12',
  VAT_OUTGOING_6 = 'vat_outgoing_6',
  VAT_INCOMING_25 = 'vat_incoming_25',
  VAT_INCOMING_12 = 'vat_incoming_12',
  VAT_INCOMING_6 = 'vat_incoming_6',
  ACCOUNTS_RECEIVABLE = 'accounts_receivable',
  ACCOUNTS_PAYABLE = 'accounts_payable',
  EXPENSE_DEFAULT = 'expense_default',
}

export interface DefaultAccount {
  id: number
  company_id: number
  account_type: DefaultAccountType
  account_id: number
  account_number?: number
  account_name?: string
}

export interface SIE4PreviewResponse {
  can_import: boolean
  fiscal_year_start: string | null
  fiscal_year_end: string | null
  fiscal_year_exists: boolean
  existing_fiscal_year_id: number | null
  will_create_fiscal_year: boolean
  accounts_count: number
  verifications_count: number
  blocking_errors: string[]
  warnings: string[]
}

export interface SIE4ImportResponse {
  success: boolean
  message: string
  accounts_created: number
  accounts_updated: number
  verifications_created: number
  verifications_skipped: number
  default_accounts_configured: number
  fiscal_year_id: number | null
  fiscal_year_created: boolean
  errors: string[]
  warnings: string[]
}

export interface VATReport {
  company_id: number
  report_type: string
  start_date: string | null
  end_date: string | null
  outgoing_vat: {
    accounts: Array<{ account_number: number; name: string; amount: number }>
    total: number
  }
  incoming_vat: {
    accounts: Array<{ account_number: number; name: string; amount: number }>
    total: number
  }
  net_vat: number
  pay_or_refund: 'pay' | 'refund' | 'zero'
  skv_3800?: {
    outgoing_25: {
      vat: number
      sales: number
      box_sales: string
      box_vat: string
    }
    outgoing_12: {
      vat: number
      sales: number
      box_sales: string
      box_vat: string
    }
    outgoing_6: {
      vat: number
      sales: number
      box_sales: string
      box_vat: string
    }
    incoming_total: {
      vat: number
      box: string
    }
    net_vat: {
      amount: number
      box: string
    }
  }
  debug_info?: {
    total_vat_accounts_found: number
    outgoing_vat_accounts: Array<{ number: number; name: string }>
    incoming_vat_accounts: Array<{ number: number; name: string }>
    transaction_groups_found: number
    accounts_with_transactions: Array<{
      number: number
      name: string
      debit: number
      credit: number
    }>
    verifications: Array<{
      id: number
      verification_number: number
      series: string
      transaction_date: string
      description: string
      transaction_lines: Array<{
        account_number: number
        account_name: string
        debit: number
        credit: number
        is_vat_account: boolean
      }>
    }>
  }
}

export interface VATPeriod {
  name: string
  start_date: string
  end_date: string
  period_type: 'monthly' | 'quarterly' | 'yearly'
}

export interface VATPeriodsResponse {
  company_id: number
  year: number
  reporting_period: string
  periods: VATPeriod[]
}

// Expenses

export enum ExpenseStatus {
  DRAFT = 'draft',
  SUBMITTED = 'submitted',
  APPROVED = 'approved',
  PAID = 'paid',
  REJECTED = 'rejected',
}

export interface Expense {
  id: number
  company_id: number
  employee_name: string
  expense_date: string
  description: string
  amount: number
  vat_amount: number
  expense_account_id?: number | null
  vat_account_id?: number | null
  status: ExpenseStatus
  approved_date?: string
  paid_date?: string
  verification_id?: number
  created_at: string
  updated_at: string
}

// Monthly Statistics

export interface MonthlyData {
  month: number
  month_name: string
  revenue: number
  expenses: number
  profit: number
}

export interface YTDTotals {
  revenue: number
  expenses: number
  profit: number
}

export interface MonthlyStatistics {
  monthly_data: MonthlyData[]
  ytd_totals: YTDTotals
}

// Attachments

export enum AttachmentStatus {
  CREATED = 'created',
  UPLOADED = 'uploaded',
  PROCESSING = 'processing',
  READY = 'ready',
  REJECTED = 'rejected',
}

export enum AttachmentRole {
  ORIGINAL = 'original',
  RECEIPT = 'receipt',
  SUPPORTING = 'supporting',
  CONTRACT = 'contract',
}

export enum EntityType {
  SUPPLIER_INVOICE = 'supplier_invoice',
  INVOICE = 'invoice',
  EXPENSE = 'expense',
  VERIFICATION = 'verification',
}

export interface AttachmentLinkItem {
  entity_type: EntityType
  entity_id: number
  role: AttachmentRole
}

export interface Attachment {
  id: number
  company_id: number
  original_filename: string
  storage_filename: string
  mime_type: string
  size_bytes: number
  checksum_sha256?: string
  status: AttachmentStatus
  rejection_reason?: string
  created_at: string
  created_by: number
  links?: AttachmentLinkItem[]
}

export interface EntityAttachment {
  link_id: number
  attachment_id: number
  role: AttachmentRole
  sort_order: number
  created_at: string
  original_filename: string
  mime_type: string
  size_bytes: number
  status: AttachmentStatus
}

// Backup & Restore

export interface BackupInfo {
  created_at: string
  app_version: string
  schema_version: string
  filename: string
  size_bytes: number
}

export interface RestoreResponse {
  success: boolean
  backup_filename: string
  message: string
  stages_completed: string[]
}

export interface BackupScheduleResponse {
  enabled: boolean
  interval_hours: number
  max_backups: number
  preferred_time: string
  last_backup_at: string | null
  next_backup_at: string | null
}

export interface BackupScheduleUpdate {
  enabled?: boolean
  interval_hours?: number
  max_backups?: number
  preferred_time?: string
}

// AI Assistant

export interface AISettings {
  ai_enabled: boolean
  ollama_url: string
  ollama_model: string
  system_prompt: string | null
  updated_at: string
}

export interface AISettingsUpdate {
  ai_enabled?: boolean
  ollama_url?: string
  ollama_model?: string
  system_prompt?: string | null
}

export interface OllamaModel {
  name: string
  size: number | null
  parameter_size: string | null
  quantization_level: string | null
  modified_at: string | null
}

export interface OllamaHealth {
  reachable: boolean
  model_available: boolean | null
  model_name: string | null
  error: string | null
}

export interface ChatSession {
  id: number
  title: string
  message_count: number
  created_at: string
  updated_at: string
}

export interface ChatMessage {
  id: number
  session_id: number
  role: 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'image_extraction'
  content: string | null
  tool_name: string | null
  tool_args: string | null
  tool_status: 'pending' | 'approved' | 'denied' | 'executed' | 'error' | null
  attachment_ids: string | null
  created_at: string
}

export interface ChatSessionDetail {
  id: number
  title: string
  created_at: string
  updated_at: string
  messages: ChatMessage[]
}

export interface ToolProposal {
  message_id: number
  tool_name: string
  display_name: string
  tool_args: Record<string, unknown>
  round: number
  ai_upload_ids?: number[]
}

export interface AIUpload {
  id: number
  original_filename: string
  mime_type: string
  size_bytes: number
  created_at: string
}
