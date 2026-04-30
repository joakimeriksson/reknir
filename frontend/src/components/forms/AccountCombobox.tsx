import { useState, useEffect, useRef } from 'react'
import type { Account } from '@/types'

export default function AccountCombobox({
  accounts,
  value,
  onChange,
  disabled,
  placeholder = 'Välj konto...',
}: {
  accounts: Account[]
  value: number
  onChange: (accountId: number) => void
  disabled?: boolean
  placeholder?: string
}) {
  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const [highlightIndex, setHighlightIndex] = useState(0)
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({})
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const selectedAccount = accounts.find(a => a.id === value)

  const filtered = query
    ? accounts.filter(a =>
        a.account_number.toString().startsWith(query) ||
        a.name.toLowerCase().includes(query.toLowerCase())
      )
    : accounts

  useEffect(() => {
    setHighlightIndex(0)
  }, [query])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const openDropdown = () => {
    setIsOpen(true)
    setQuery('')
    if (inputRef.current) {
      const rect = inputRef.current.getBoundingClientRect()
      setDropdownStyle({
        position: 'fixed',
        top: rect.bottom + 4,
        left: rect.left,
        minWidth: rect.width,
        width: 'max-content',
      })
    }
    if (selectedAccount) {
      const idx = accounts.findIndex(a => a.id === selectedAccount.id)
      if (idx >= 0) {
        setHighlightIndex(idx)
        requestAnimationFrame(() => {
          const list = listRef.current
          const item = list?.children[idx] as HTMLElement | undefined
          if (list && item) {
            list.scrollTop = item.offsetTop - list.clientHeight / 2 + item.clientHeight / 2
          }
        })
      }
    }
  }

  const selectAccount = (account: Account) => {
    onChange(account.id)
    setQuery('')
    setIsOpen(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        openDropdown()
        e.preventDefault()
      }
      return
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setHighlightIndex(i => Math.min(i + 1, filtered.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setHighlightIndex(i => Math.max(i - 1, 0))
        break
      case 'Enter':
        e.preventDefault()
        if (filtered[highlightIndex]) {
          selectAccount(filtered[highlightIndex])
        }
        break
      case 'Escape':
        setIsOpen(false)
        setQuery('')
        break
      case 'Tab':
        if (filtered[highlightIndex]) {
          selectAccount(filtered[highlightIndex])
        }
        setIsOpen(false)
        setQuery('')
        break
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        value={isOpen ? query : (selectedAccount ? `${selectedAccount.account_number} - ${selectedAccount.name}` : '')}
        onChange={(e) => {
          setQuery(e.target.value)
          if (!isOpen) openDropdown()
        }}
        onFocus={openDropdown}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="w-full px-2 py-1 border border-gray-300 rounded text-sm"
        disabled={disabled}
        autoComplete="off"
      />
      {isOpen && !disabled && (
        <ul
          ref={listRef}
          style={dropdownStyle}
          className="z-50 max-h-80 overflow-y-auto bg-white border border-gray-300 rounded shadow-lg text-sm"
        >
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-gray-400">Inget konto hittades</li>
          ) : (
            filtered.map((account, i) => (
              <li
                key={account.id}
                onMouseDown={() => selectAccount(account)}
                className={`px-3 py-1.5 cursor-pointer ${
                  i === highlightIndex ? 'bg-primary-100 text-primary-900' : 'hover:bg-gray-100'
                }`}
              >
                <span className="font-mono">{account.account_number}</span> - {account.name}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
