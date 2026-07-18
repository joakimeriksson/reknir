import { Bot } from 'lucide-react'

interface ChatFABProps {
  onClick: () => void
}

export default function ChatFAB({ onClick }: ChatFABProps) {
  return (
    <button
      onClick={onClick}
      className="fixed bottom-6 right-6 z-40 w-14 h-14 bg-primary-600 text-white rounded-full shadow-lg hover:bg-primary-700 hover:shadow-xl transition-all flex items-center justify-center"
      title="AI-assistent"
    >
      <Bot className="w-6 h-6" />
    </button>
  )
}
