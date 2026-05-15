import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { X, Plus, Send, Paperclip, Loader2, Trash2, ChevronDown, FileSearch } from 'lucide-react'
import { useCompany } from '@/contexts/CompanyContext'
import { useAIForm } from '@/contexts/AIFormContext'
import type { AIFormType } from '@/contexts/AIFormContext'
import { useAIChat } from '@/hooks/useAIChat'
import { aiApi } from '@/services/api'
import ChatMessageComponent from './ChatMessage'
import type { AIUpload } from '@/types'

interface ChatPanelProps {
  isOpen: boolean
  onClose: () => void
}

// Map tool names to form types and routes
const TOOL_FORM_MAP: Record<string, { type: AIFormType; route: string }> = {
  create_invoice: { type: 'invoice', route: '/invoices' },
  create_verification: { type: 'verification', route: '/verifications' },
  create_supplier_invoice: { type: 'supplier_invoice', route: '/invoices' },
  create_expense: { type: 'expense', route: '/expenses' },
  create_customer: { type: 'customer', route: '/customers' },
  create_supplier: { type: 'supplier', route: '/customers' },
  create_account: { type: 'account', route: '/accounts' },
}

export default function ChatPanel({ isOpen, onClose }: ChatPanelProps) {
  const { selectedCompany } = useCompany()
  const { openForm } = useAIForm()
  const navigate = useNavigate()
  const location = useLocation()
  const {
    messages,
    sessions,
    currentSessionId,
    isStreaming,
    isExtracting,
    pendingProposal,
    streamingContent,
    error,
    sendMessage,
    approveProposal,
    loadSessions,
    loadSession,
    deleteSession,
    startNewChat,
    clearProposal,
    setError,
  } = useAIChat()

  const [input, setInput] = useState('')
  const [uploads, setUploads] = useState<AIUpload[]>([])
  const [uploading, setUploading] = useState(false)
  const [showSessionDropdown, setShowSessionDropdown] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dropZoneRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  // When a tool_proposal arrives for a write tool, open the real form instead
  useEffect(() => {
    if (!pendingProposal) return
    const mapping = TOOL_FORM_MAP[pendingProposal.tool_name]
    if (!mapping) return

    openForm(mapping.type, pendingProposal.tool_args, pendingProposal.message_id, pendingProposal.ai_upload_ids)
    clearProposal()
    if (location.pathname !== mapping.route) {
      navigate(mapping.route)
    }
  }, [pendingProposal, openForm, clearProposal, navigate, location.pathname])

  // Load sessions when panel opens
  useEffect(() => {
    if (isOpen && selectedCompany) {
      loadSessions(selectedCompany.id)
    }
  }, [isOpen, selectedCompany, loadSessions])

  // Load latest session only on initial panel open (not after new chat)
  const hasInitialized = useRef(false)
  useEffect(() => {
    if (isOpen && !hasInitialized.current && sessions.length > 0 && !currentSessionId) {
      loadSession(sessions[0].id)
      hasInitialized.current = true
    }
  }, [isOpen, sessions, currentSessionId, loadSession])

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`
    }
  }, [input])

  const handleSend = useCallback(() => {
    if (!input.trim() || isStreaming || !selectedCompany) return
    const attachmentIds = uploads.map((u) => u.id)
    sendMessage(input.trim(), selectedCompany.id, attachmentIds.length > 0 ? attachmentIds : undefined)
    setInput('')
    setUploads([])
  }, [input, isStreaming, selectedCompany, uploads, sendMessage])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleFileUpload = async (files: FileList | File[]) => {
    if (!selectedCompany) return
    setUploading(true)
    try {
      for (const file of Array.from(files)) {
        const resp = await aiApi.uploadFile(selectedCompany.id, file)
        setUploads((prev) => [...prev, resp.data])
      }
    } catch {
      setError('Kunde inte ladda upp filen.')
    } finally {
      setUploading(false)
    }
  }

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) {
      handleFileUpload(e.target.files)
      e.target.value = ''
    }
  }

  // Drag and drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer.files.length > 0) {
      handleFileUpload(e.dataTransfer.files)
    }
  }

  const handleNewChat = () => {
    startNewChat()
    setShowSessionDropdown(false)
    if (selectedCompany) loadSessions(selectedCompany.id)
  }

  const handleSelectSession = (sessionId: number) => {
    loadSession(sessionId)
    setShowSessionDropdown(false)
  }

  const handleDeleteSession = async (e: React.MouseEvent, sessionId: number) => {
    e.stopPropagation()
    await deleteSession(sessionId)
    if (selectedCompany) loadSessions(selectedCompany.id)
  }

  const currentSession = sessions.find((s) => s.id === currentSessionId)

  return (
    <div
      className={`fixed top-0 right-0 h-full w-[420px] bg-white border-l border-gray-200 shadow-xl z-40 flex flex-col transition-transform duration-300 ${
        isOpen ? 'translate-x-0' : 'translate-x-full'
      }`}
      ref={dropZoneRef}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50 flex-shrink-0">
        <h2 className="text-base font-semibold text-gray-800">AI-assistent</h2>
        <div className="flex items-center gap-1.5">
          <button
            onClick={handleNewChat}
            className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
            title="Ny chatt"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded-lg transition-colors"
            title="Stäng"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Session selector */}
      <div className="relative px-4 py-2 border-b border-gray-100 flex-shrink-0">
        <button
          onClick={() => setShowSessionDropdown(!showSessionDropdown)}
          className="w-full flex items-center justify-between text-sm text-gray-700 hover:text-gray-900 py-1 transition-colors"
        >
          <span className="truncate">
            {currentSession ? currentSession.title : 'Ny konversation'}
          </span>
          <ChevronDown className={`w-4 h-4 flex-shrink-0 transition-transform ${showSessionDropdown ? 'rotate-180' : ''}`} />
        </button>

        {showSessionDropdown && (
          <div className="absolute left-2 right-2 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto">
            {sessions.map((session) => (
              <div
                key={session.id}
                onClick={() => handleSelectSession(session.id)}
                className={`flex items-center justify-between px-3 py-2 text-sm cursor-pointer hover:bg-gray-50 ${
                  session.id === currentSessionId ? 'bg-primary-50 text-primary-700' : 'text-gray-700'
                }`}
              >
                <div className="flex-1 min-w-0 mr-2">
                  <div className="truncate">{session.title}</div>
                  <div className="text-xs text-gray-400">{session.message_count} meddelanden</div>
                </div>
                <button
                  onClick={(e) => handleDeleteSession(e, session.id)}
                  className="p-1 text-gray-400 hover:text-red-500 flex-shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
            {sessions.length === 0 && (
              <div className="px-3 py-4 text-sm text-gray-400 text-center">Inga tidigare konversationer</div>
            )}
          </div>
        )}
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
        {messages.length === 0 && !isStreaming && (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm">
            Skriv ett meddelande för att börja
          </div>
        )}

        {messages.filter((msg) => {
          if (msg.role !== 'tool_call') return true
          // Hide tool_call if a matching tool_result exists (avoid duplicates on reload)
          return !messages.some((m) => m.role === 'tool_result' && m.tool_name === msg.tool_name && m.id > msg.id)
        }).map((msg, idx, filtered) => {
          const isToolStep = msg.role === 'tool_call' || msg.role === 'tool_result'
          const nextMsg = filtered[idx + 1]
          const isLastToolStep = isToolStep && (!nextMsg || (nextMsg.role !== 'tool_call' && nextMsg.role !== 'tool_result'))

          return (
            <ChatMessageComponent
              key={msg.id}
              message={msg}
              pendingProposal={pendingProposal}
              onApprove={approveProposal}
              isLastToolStep={isLastToolStep}
            />
          )
        })}

        {/* Streaming message */}
        {isStreaming && streamingContent && (
          <ChatMessageComponent
            message={{
              id: -1,
              session_id: 0,
              role: 'assistant',
              content: streamingContent,
              tool_name: null,
              tool_args: null,
              tool_status: null,
              attachment_ids: null,
              created_at: new Date().toISOString(),
            }}
            isStreaming={true}
            streamingContent={streamingContent}
          />
        )}

        {/* Image extraction indicator */}
        {isExtracting && (
          <div className="flex justify-start mb-3">
            <div className="flex items-center gap-2 bg-blue-50 border border-blue-100 px-4 py-2.5 rounded-2xl rounded-bl-md text-sm text-blue-700 animate-pulse">
              <FileSearch className="w-4 h-4" />
              <span>Analyserar dokument...</span>
            </div>
          </div>
        )}

        {/* Loading indicator */}
        {isStreaming && !streamingContent && !isExtracting && (
          <div className="flex justify-start mb-3">
            <div className="bg-gray-100 px-4 py-2.5 rounded-2xl rounded-bl-md">
              <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Error message */}
      {error && (
        <div className="mx-4 mb-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700 ml-2">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Drag overlay */}
      {isDragging && (
        <div className="absolute inset-0 bg-primary-50/80 border-2 border-dashed border-primary-400 rounded-lg z-50 flex items-center justify-center">
          <p className="text-primary-600 font-medium">Släpp filer här</p>
        </div>
      )}

      {/* Uploaded files preview */}
      {uploads.length > 0 && (
        <div className="px-4 py-2 border-t border-gray-100 flex-shrink-0">
          <div className="flex flex-wrap gap-2">
            {uploads.map((upload) => (
              <div
                key={upload.id}
                className="flex items-center gap-1.5 bg-gray-100 px-2.5 py-1 rounded-lg text-xs text-gray-700"
              >
                <Paperclip className="w-3 h-3" />
                <span className="truncate max-w-[150px]">{upload.original_filename}</span>
                <button
                  onClick={() => setUploads((prev) => prev.filter((u) => u.id !== upload.id))}
                  className="text-gray-400 hover:text-gray-600"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Input area */}
      <div className="border-t border-gray-200 p-3 flex-shrink-0">
        <div className="flex items-end gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading || isStreaming}
            className="p-2 text-gray-400 hover:text-gray-600 disabled:opacity-50 transition-colors flex-shrink-0"
            title="Bifoga fil"
          >
            {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Paperclip className="w-5 h-5" />}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept="image/jpeg,image/png,image/gif,application/pdf"
            multiple
            onChange={handleFileInputChange}
          />
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Skriv ett meddelande..."
            disabled={isStreaming}
            rows={1}
            className="flex-1 resize-none text-sm px-3 py-2 border border-gray-200 rounded-xl focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500 disabled:opacity-50 max-h-[120px]"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isStreaming}
            className="p-2 text-white bg-primary-600 rounded-xl hover:bg-primary-700 disabled:opacity-50 disabled:hover:bg-primary-600 transition-colors flex-shrink-0"
            title="Skicka"
          >
            <Send className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  )
}
