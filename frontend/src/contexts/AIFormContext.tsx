import { createContext, useContext, useState, useCallback } from 'react'
import type { ReactNode } from 'react'

export type AIFormType =
  | 'invoice'
  | 'verification'
  | 'supplier_invoice'
  | 'expense'
  | 'customer'
  | 'supplier'
  | 'account'

export interface PendingForm {
  type: AIFormType
  data: Record<string, unknown>
  messageId: number
  aiUploadIds?: number[]
}

interface AIFormContextType {
  pendingForm: PendingForm | null
  openForm: (type: AIFormType, data: Record<string, unknown>, messageId: number, aiUploadIds?: number[]) => void
  clearForm: () => void
}

const AIFormContext = createContext<AIFormContextType>({
  pendingForm: null,
  openForm: () => {},
  clearForm: () => {},
})

export function AIFormProvider({ children }: { children: ReactNode }) {
  const [pendingForm, setPendingForm] = useState<PendingForm | null>(null)

  const openForm = useCallback((type: AIFormType, data: Record<string, unknown>, messageId: number, aiUploadIds?: number[]) => {
    setPendingForm({ type, data, messageId, aiUploadIds })
  }, [])

  const clearForm = useCallback(() => {
    setPendingForm(null)
  }, [])

  return (
    <AIFormContext.Provider value={{ pendingForm, openForm, clearForm }}>
      {children}
    </AIFormContext.Provider>
  )
}

export function useAIForm() {
  return useContext(AIFormContext)
}
