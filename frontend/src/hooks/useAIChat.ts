import { useState, useCallback, useRef } from 'react'
import { aiApi } from '@/services/api'
import type { ChatMessage, ChatSession, ToolProposal } from '@/types'

// Tools that open real forms — no approval card needed
const FORM_TOOLS = new Set([
  'create_invoice', 'create_verification', 'create_supplier_invoice',
  'create_expense', 'create_customer', 'create_supplier', 'create_account',
])

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api'

interface SSEEvent {
  event: string
  data: string
}

function parseSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onEvent: (event: SSEEvent) => void,
  onDone: () => void,
  onError: (error: string) => void
) {
  const decoder = new TextDecoder()
  let buffer = ''
  let currentEvent = ''
  let currentData = ''

  function processLine(line: string) {
    if (line.startsWith('event:')) {
      currentEvent = line.slice(6).trim()
    } else if (line.startsWith('data:')) {
      currentData = line.slice(5).trim()
    } else if (line === '') {
      // Empty line = end of event
      if (currentEvent || currentData) {
        onEvent({ event: currentEvent || 'message', data: currentData })
        currentEvent = ''
        currentData = ''
      }
    }
  }

  function read() {
    reader.read().then(({ done, value }) => {
      if (done) {
        // Process remaining buffer
        if (buffer) {
          const lines = buffer.split(/\r\n|\r|\n/)
          for (const line of lines) {
            processLine(line)
          }
          // Fire last event if pending
          if (currentEvent || currentData) {
            onEvent({ event: currentEvent || 'message', data: currentData })
          }
        }
        onDone()
        return
      }

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split(/\r\n|\r|\n/)
      // Keep the last partial line in the buffer
      buffer = lines.pop() || ''
      for (const line of lines) {
        processLine(line)
      }

      read()
    }).catch((err) => {
      onError(err.message || 'Stream read error')
    })
  }

  read()
}

export function useAIChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<number | null>(null)
  const [isStreaming, setIsStreaming] = useState(false)
  const [isExtracting, setIsExtracting] = useState(false)
  const [pendingProposal, setPendingProposal] = useState<ToolProposal | null>(null)
  const [streamingContent, setStreamingContent] = useState('')
  const [error, setError] = useState<string | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  const getToken = () => localStorage.getItem('auth_token') || ''

  const loadSessions = useCallback(async (companyId: number) => {
    try {
      const resp = await aiApi.listSessions(companyId)
      setSessions(resp.data)
    } catch {
      setSessions([])
    }
  }, [])

  const loadSession = useCallback(async (sessionId: number) => {
    try {
      const resp = await aiApi.getSession(sessionId)
      setMessages(resp.data.messages)
      setCurrentSessionId(sessionId)
      // Check for pending proposals (only non-form tools)
      const pending = resp.data.messages.find(
        (m) => m.role === 'tool_call' && m.tool_status === 'pending' && !FORM_TOOLS.has(m.tool_name || '')
      )
      if (pending) {
        setPendingProposal({
          message_id: pending.id,
          tool_name: pending.tool_name || '',
          display_name: pending.tool_name || '',
          tool_args: pending.tool_args ? JSON.parse(pending.tool_args) : {},
          round: 0,
        })
      } else {
        setPendingProposal(null)
      }
    } catch {
      setError('Kunde inte ladda sessionen.')
    }
  }, [])

  const deleteSession = useCallback(async (sessionId: number) => {
    try {
      await aiApi.deleteSession(sessionId)
      if (currentSessionId === sessionId) {
        setMessages([])
        setCurrentSessionId(null)
        setPendingProposal(null)
      }
    } catch {
      setError('Kunde inte ta bort sessionen.')
    }
  }, [currentSessionId])

  const startNewChat = useCallback(() => {
    setMessages([])
    setCurrentSessionId(null)
    setPendingProposal(null)
    setStreamingContent('')
    setError(null)
  }, [])

  const handleSSEEvents = useCallback((
    response: Response,
    onComplete: () => void,
  ) => {
    if (!response.body) {
      setError('Inget svar från servern.')
      onComplete()
      return
    }

    const reader = response.body.getReader()
    let accumulatedContent = ''

    parseSSEStream(
      reader,
      (event) => {
        try {
          const data = event.data ? JSON.parse(event.data) : {}

          switch (event.event) {
            case 'image_extracting': {
              setIsExtracting(true)
              break
            }
            case 'image_extracted': {
              setIsExtracting(false)
              const extractionMsg: ChatMessage = {
                id: Date.now(),
                session_id: 0,
                role: 'image_extraction',
                content: data.content || '',
                tool_name: null,
                tool_args: null,
                tool_status: null,
                attachment_ids: null,
                created_at: new Date().toISOString(),
              }
              setMessages((prev) => [...prev, extractionMsg])
              break
            }
            case 'token': {
              accumulatedContent += data.content || ''
              setStreamingContent(accumulatedContent)
              break
            }
            case 'tool_executing': {
              if (accumulatedContent) {
                const textMsg: ChatMessage = {
                  id: Date.now(),
                  session_id: 0,
                  role: 'assistant',
                  content: accumulatedContent,
                  tool_name: null,
                  tool_args: null,
                  tool_status: null,
                  attachment_ids: null,
                  created_at: new Date().toISOString(),
                }
                setMessages((prev) => [...prev, textMsg])
                accumulatedContent = ''
                setStreamingContent('')
              }
              const toolMsg: ChatMessage = {
                id: Date.now(),
                session_id: 0,
                role: 'tool_call',
                content: data.display_name || data.tool_name,
                tool_name: data.tool_name,
                tool_args: null,
                tool_status: 'executed',
                attachment_ids: null,
                created_at: new Date().toISOString(),
              }
              setMessages((prev) => [...prev, toolMsg])
              break
            }
            case 'tool_result': {
              // Merge result into the preceding tool_call message instead of creating a separate message
              const resultJson = JSON.stringify(data.result, null, 2)
              setMessages((prev) => {
                const updated = [...prev]
                // Find the last tool_call for this tool_name and attach the result
                for (let i = updated.length - 1; i >= 0; i--) {
                  if (updated[i].role === 'tool_call' && updated[i].tool_name === data.tool_name && !updated[i].tool_args) {
                    updated[i] = { ...updated[i], tool_args: resultJson }
                    return updated
                  }
                }
                // Fallback: add as separate message
                return [...prev, {
                  id: Date.now() + 1,
                  session_id: 0,
                  role: 'tool_result',
                  content: resultJson,
                  tool_name: data.display_name || data.tool_name,
                  tool_args: null,
                  tool_status: null,
                  attachment_ids: null,
                  created_at: new Date().toISOString(),
                }]
              })
              break
            }
            case 'tool_proposal': {
              const proposalMsg: ChatMessage = {
                id: data.message_id,
                session_id: 0,
                role: 'tool_call',
                content: data.display_name || data.tool_name,
                tool_name: data.tool_name,
                tool_args: FORM_TOOLS.has(data.tool_name) ? null : JSON.stringify(data.tool_args),
                tool_status: FORM_TOOLS.has(data.tool_name) ? 'executed' : 'pending',
                attachment_ids: null,
                created_at: new Date().toISOString(),
              }
              setMessages((prev) => [...prev, proposalMsg])
              setPendingProposal({
                message_id: data.message_id,
                tool_name: data.tool_name,
                display_name: data.display_name,
                tool_args: data.tool_args,
                round: data.round,
                ai_upload_ids: data.ai_upload_ids,
              })
              break
            }
            case 'tool_status': {
              // Update the tool_call message status
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === data.message_id
                    ? { ...m, tool_status: data.status }
                    : m
                )
              )
              if (data.status === 'denied') {
                setPendingProposal(null)
              }
              break
            }
            case 'done': {
              if (accumulatedContent) {
                const assistantMsg: ChatMessage = {
                  id: Date.now() + 2,
                  session_id: data.session_id || 0,
                  role: 'assistant',
                  content: accumulatedContent,
                  tool_name: null,
                  tool_args: null,
                  tool_status: null,
                  attachment_ids: null,
                  created_at: new Date().toISOString(),
                }
                setMessages((prev) => [...prev, assistantMsg])
                accumulatedContent = ''
                setStreamingContent('')
              }
              if (data.session_id) {
                setCurrentSessionId(data.session_id)
              }
              break
            }
            case 'error': {
              setError(data.message || 'Ett fel uppstod.')
              break
            }
          }
        } catch {
          // Ignore JSON parse errors for malformed events
        }
      },
      () => {
        // Stream done
        onComplete()
      },
      (errMsg) => {
        setError(errMsg)
        onComplete()
      }
    )
  }, [])

  const sendMessage = useCallback(async (
    content: string,
    companyId: number,
    attachmentIds?: number[],
  ) => {
    setIsStreaming(true)
    setError(null)
    setStreamingContent('')

    // Add user message optimistically
    const userMsg: ChatMessage = {
      id: Date.now(),
      session_id: currentSessionId || 0,
      role: 'user',
      content,
      tool_name: null,
      tool_args: null,
      tool_status: null,
      attachment_ids: attachmentIds ? JSON.stringify(attachmentIds) : null,
      created_at: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, userMsg])

    try {
      const controller = new AbortController()
      abortControllerRef.current = controller

      const response = await fetch(`${API_BASE_URL}/ai/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({
          content,
          company_id: companyId,
          session_id: currentSessionId,
          attachment_ids: attachmentIds,
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}))
        setError(errBody.detail || `Fel: ${response.status}`)
        setIsStreaming(false)
        return
      }

      handleSSEEvents(response, () => {
        setIsStreaming(false)
        abortControllerRef.current = null
      })
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return
      setError('Kunde inte ansluta till AI-assistenten.')
      setIsStreaming(false)
    }
  }, [currentSessionId, handleSSEEvents])

  const approveProposal = useCallback(async (
    messageId: number,
    approved: boolean,
    updatedArgs?: Record<string, unknown>,
  ) => {
    if (!currentSessionId) return

    setIsStreaming(true)
    setError(null)
    setPendingProposal(null)
    setStreamingContent('')

    try {
      const controller = new AbortController()
      abortControllerRef.current = controller

      const response = await fetch(`${API_BASE_URL}/ai/chat/approve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${getToken()}`,
        },
        body: JSON.stringify({
          session_id: currentSessionId,
          message_id: messageId,
          approved,
          updated_args: updatedArgs,
        }),
        signal: controller.signal,
      })

      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}))
        setError(errBody.detail || `Fel: ${response.status}`)
        setIsStreaming(false)
        return
      }

      handleSSEEvents(response, () => {
        setIsStreaming(false)
        abortControllerRef.current = null
      })
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') return
      setError('Kunde inte godkänna åtgärden.')
      setIsStreaming(false)
    }
  }, [currentSessionId, handleSSEEvents])

  const stopStreaming = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
      setIsStreaming(false)
    }
  }, [])

  const clearProposal = useCallback(() => {
    setPendingProposal(null)
  }, [])

  return {
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
    stopStreaming,
    clearProposal,
    setError,
  }
}
