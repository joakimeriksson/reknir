import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { ChevronDown, ChevronRight, Loader2, Check, X as XIcon, AlertCircle, FileSearch } from 'lucide-react'
import type { ChatMessage as ChatMessageType, ToolProposal } from '@/types'
import ToolProposalCard from './ToolProposalCard'

interface ChatMessageProps {
  message: ChatMessageType
  isStreaming?: boolean
  streamingContent?: string
  pendingProposal?: ToolProposal | null
  onApprove?: (messageId: number, approved: boolean, updatedArgs?: Record<string, unknown>) => void
  isLastToolStep?: boolean
}

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  get_company_info: 'Hämtar företagsinformation',
  list_fiscal_years: 'Hämtar räkenskapsår',
  list_accounts: 'Hämtar kontoplan',
  get_account_ledger: 'Hämtar kontoreskontra',
  list_verifications: 'Hämtar verifikationer',
  get_verification: 'Hämtar verifikation',
  list_suppliers: 'Hämtar leverantörer',
  get_supplier: 'Hämtar leverantör',
  list_customers: 'Hämtar kunder',
  get_customer: 'Hämtar kund',
  list_invoices: 'Hämtar fakturor',
  get_invoice: 'Hämtar faktura',
  list_supplier_invoices: 'Hämtar leverantörsfakturor',
  get_supplier_invoice: 'Hämtar leverantörsfaktura',
  list_expenses: 'Hämtar utlägg',
  get_expense: 'Hämtar utlägg',
  get_balance_sheet: 'Hämtar balansräkning',
  get_income_statement: 'Hämtar resultaträkning',
  get_vat_report: 'Hämtar momsrapport',
  list_posting_templates: 'Hämtar konteringsmallar',
  create_verification: 'Skapa verifikation',
  create_supplier: 'Skapa leverantör',
  create_customer: 'Skapa kund',
  create_account: 'Skapa konto',
  create_supplier_invoice: 'Skapa leverantörsfaktura',
  register_supplier_invoice: 'Bokför leverantörsfaktura',
  mark_supplier_invoice_paid: 'Markera leverantörsfaktura betald',
  create_invoice: 'Skapa faktura',
  send_invoice: 'Skicka faktura',
  mark_invoice_paid: 'Markera faktura betald',
  create_expense: 'Skapa utlägg',
}

function getDisplayName(toolName: string | null, fallbackContent: string | null): string {
  if (toolName && TOOL_DISPLAY_NAMES[toolName]) return TOOL_DISPLAY_NAMES[toolName]
  if (fallbackContent) return fallbackContent
  return toolName || 'Verktyg'
}

export default function ChatMessage({
  message,
  isStreaming,
  streamingContent,
  pendingProposal,
  onApprove,
  isLastToolStep,
}: ChatMessageProps) {
  const [resultExpanded, setResultExpanded] = useState(false)

  if (message.role === 'user') {
    return (
      <div className="flex justify-end mb-3">
        <div className="max-w-[85%] bg-primary-600 text-white px-4 py-2.5 rounded-2xl rounded-br-md text-sm">
          {message.content}
          {message.attachment_ids && (
            <div className="mt-1.5 text-xs text-primary-200">
              {JSON.parse(message.attachment_ids).length} bifogad(e) fil(er)
            </div>
          )}
        </div>
      </div>
    )
  }

  if (message.role === 'assistant') {
    const content = isStreaming && streamingContent ? streamingContent : message.content || ''
    return (
      <div className="flex justify-start mb-3">
        <div className="max-w-[85%] bg-white border border-gray-200 px-4 py-2.5 rounded-2xl rounded-bl-md text-sm leading-relaxed ai-markdown">
          <ReactMarkdown>{content}</ReactMarkdown>
          {isStreaming && (
            <span className="inline-block w-1.5 h-4 bg-primary-600 animate-pulse ml-0.5 align-text-bottom" />
          )}
        </div>
      </div>
    )
  }

  if (message.role === 'tool_call') {
    // Show approval card only for non-form tools (form tools open the real UI instead)
    const FORM_TOOLS = new Set([
      'create_invoice', 'create_verification', 'create_supplier_invoice',
      'create_expense', 'create_customer', 'create_supplier', 'create_account',
    ])
    if (pendingProposal && pendingProposal.message_id === message.id && onApprove && !FORM_TOOLS.has(message.tool_name || '')) {
      return (
        <div className="mb-3">
          <ToolProposalCard proposal={pendingProposal} onApprove={onApprove} />
        </div>
      )
    }

    const displayName = getDisplayName(message.tool_name, message.content)
    const hasResult = !!message.tool_args // result is stored in tool_args by the hook
    const statusIcon = message.tool_status === 'executed'
      ? <Check className="w-3.5 h-3.5 text-green-500" />
      : message.tool_status === 'error'
        ? <AlertCircle className="w-3.5 h-3.5 text-red-500" />
        : message.tool_status === 'denied'
          ? <XIcon className="w-3.5 h-3.5 text-gray-400" />
          : <Loader2 className="w-3.5 h-3.5 text-primary-500 animate-spin" />

    return (
      <div className={`relative pl-6 ${isLastToolStep ? 'mb-2' : ''}`}>
        {/* Vertical connector line */}
        {!isLastToolStep && (
          <div className="absolute left-[11px] top-[22px] bottom-0 w-px bg-gray-200" />
        )}

        {/* Step dot */}
        <div className="absolute left-0 top-[5px] w-[23px] flex justify-center">
          {statusIcon}
        </div>

        {/* Step content */}
        <div className="pb-3">
          <button
            onClick={() => hasResult && setResultExpanded(!resultExpanded)}
            className={`text-sm text-gray-600 flex items-center gap-1.5 ${hasResult ? 'hover:text-gray-900 cursor-pointer' : 'cursor-default'}`}
          >
            <span>{displayName}</span>
            {hasResult && (
              resultExpanded
                ? <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
                : <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
            )}
          </button>

          {/* Expanded result */}
          {resultExpanded && hasResult && (
            <div className="mt-1.5 text-xs bg-gray-50 border border-gray-100 rounded-lg p-3 max-h-48 overflow-auto font-mono whitespace-pre-wrap text-gray-600">
              {message.tool_args}
            </div>
          )}
        </div>
      </div>
    )
  }

  if (message.role === 'image_extraction') {
    return (
      <div className="flex justify-start mb-3">
        <div className="max-w-[85%] bg-blue-50 border border-blue-100 rounded-2xl rounded-bl-md px-4 py-2.5 text-sm">
          <button
            onClick={() => setResultExpanded(!resultExpanded)}
            className="flex items-center gap-2 text-blue-700 hover:text-blue-900 font-medium w-full"
          >
            <FileSearch className="w-4 h-4 shrink-0" />
            <span>Dokumentanalys</span>
            {resultExpanded
              ? <ChevronDown className="w-3.5 h-3.5 ml-auto" />
              : <ChevronRight className="w-3.5 h-3.5 ml-auto" />
            }
          </button>
          {resultExpanded && (
            <div className="mt-2 text-xs text-blue-900/80 leading-relaxed ai-markdown">
              <ReactMarkdown>{message.content || ''}</ReactMarkdown>
            </div>
          )}
        </div>
      </div>
    )
  }

  // Standalone tool_result (fallback if not merged into tool_call)
  if (message.role === 'tool_result') {
    const displayName = getDisplayName(message.tool_name, null)
    return (
      <div className="relative pl-6 mb-2">
        <div className="absolute left-0 top-[5px] w-[23px] flex justify-center">
          <Check className="w-3.5 h-3.5 text-green-500" />
        </div>
        <div className="pb-3">
          <button
            onClick={() => setResultExpanded(!resultExpanded)}
            className="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1.5"
          >
            <span>{displayName}</span>
            {resultExpanded
              ? <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
              : <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
            }
          </button>
          {resultExpanded && (
            <div className="mt-1.5 text-xs bg-gray-50 border border-gray-100 rounded-lg p-3 max-h-48 overflow-auto font-mono whitespace-pre-wrap text-gray-600">
              {message.content}
            </div>
          )}
        </div>
      </div>
    )
  }

  return null
}
