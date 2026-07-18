import { useState, useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route, Link, useLocation } from 'react-router-dom'
import { Home, FileText, PieChart, Settings, Receipt, BookOpen, Users, Wallet, LogOut, User, UserCog, Mail } from 'lucide-react'
import Dashboard from './pages/Dashboard'
import Verifications from './pages/Verifications'
import VerificationDetail from './pages/VerificationDetail'
import Invoices from './pages/Invoices'
import InvoiceDetail from './pages/InvoiceDetail'
import SupplierInvoiceDetail from './pages/SupplierInvoiceDetail'
import Customers from './pages/Customers'
import Accounts from './pages/Accounts'
import AccountLedger from './pages/AccountLedger'
import Reports from './pages/Reports'
import Expenses from './pages/Expenses'
import ExpenseDetail from './pages/ExpenseDetail'
import SettingsPage from './pages/Settings'
import UsersPage from './pages/Users'
import InvitationsPage from './pages/Invitations'
import InviteAccept from './pages/InviteAccept'
import Setup from './pages/Setup'
import Login from './pages/Login'
import { FiscalYearProvider } from './contexts/FiscalYearContext'
import { LayoutSettingsProvider } from './contexts/LayoutSettingsContext'
import CompanySelector from './components/CompanySelector'
import { CompanyProvider, useCompany } from './contexts/CompanyContext'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { ToastProvider } from './contexts/ToastContext'
import ProtectedRoute from './components/ProtectedRoute'
import ChatFAB from './components/ai/ChatFAB'
import ChatPanel from './components/ai/ChatPanel'
import { AIFormProvider } from './contexts/AIFormContext'
import { aiApi } from './services/api'

function App() {
  return (
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <LayoutSettingsProvider>
          <ToastProvider>
          <CompanyProvider>
            <FiscalYearProvider>
              <AIFormProvider>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="/invite/:token" element={<InviteAccept />} />
                <Route path="/setup" element={<Setup />} />
                <Route path="/*" element={<ProtectedRoute><AppContent /></ProtectedRoute>} />
              </Routes>
              </AIFormProvider>
            </FiscalYearProvider>
          </CompanyProvider>
          </ToastProvider>
        </LayoutSettingsProvider>
      </AuthProvider>
    </Router>
  )
}

function AppContent() {
  const location = useLocation()
  const { user, logout } = useAuth()
  const { selectedCompany, setSelectedCompany } = useCompany()
  const [isChatOpen, setIsChatOpen] = useState(false)
  const [aiEnabled, setAiEnabled] = useState(false)

  useEffect(() => {
    aiApi.getSettings().then((resp) => {
      setAiEnabled(resp.data.ai_enabled)
    }).catch(() => {
      setAiEnabled(false)
    })
  }, [])

  const menuItems = [
    { path: '/', icon: Home, label: 'Översikt' },
    { path: '/invoices', icon: Receipt, label: 'Fakturor' },
    { path: '/expenses', icon: Wallet, label: 'Utlägg' },
    { path: '/verifications', icon: FileText, label: 'Verifikationer' },
    { path: '/customers', icon: Users, label: 'Kunder' },
    { path: '/accounts', icon: BookOpen, label: 'Kontoplan' },
    { path: '/reports', icon: PieChart, label: 'Rapporter' },
    { path: '/settings', icon: Settings, label: 'Inställningar' },
  ]

  const handleLogout = () => {
    if (window.confirm('Är du säker på att du vill logga ut?')) {
      logout()
    }
  }

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <div className="w-64 bg-white border-r border-gray-200 flex flex-col">
        {/* Logo */}
        <div className="h-16 flex items-center px-6 border-b border-gray-200">
          <h1 className="text-2xl font-bold text-primary-600" style={{ fontFamily: "'MedievalSharp', serif" }}>
            REKNIR
          </h1>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
          {menuItems.map((item) => {
            const Icon = item.icon
            const isActive = location.pathname === item.path ||
                           (item.path !== '/' && location.pathname.startsWith(item.path))

            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-primary-50 text-primary-700'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                <Icon className={`w-5 h-5 mr-3 ${isActive ? 'text-primary-600' : 'text-gray-500'}`} />
                {item.label}
              </Link>
            )
          })}

          {/* Admin-only menu items */}
          {user?.is_admin && (
            <>
              <div className="pt-4 pb-2 px-4 text-xs font-semibold text-gray-500 uppercase">
                Administration
              </div>
              <Link
                to="/users"
                className={`flex items-center px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                  location.pathname.startsWith('/users')
                    ? 'bg-primary-50 text-primary-700'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                <UserCog className={`w-5 h-5 mr-3 ${location.pathname.startsWith('/users') ? 'text-primary-600' : 'text-gray-500'}`} />
                Användare
              </Link>
              <Link
                to="/invitations"
                className={`flex items-center px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                  location.pathname.startsWith('/invitations')
                    ? 'bg-primary-50 text-primary-700'
                    : 'text-gray-700 hover:bg-gray-100'
                }`}
              >
                <Mail className={`w-5 h-5 mr-3 ${location.pathname.startsWith('/invitations') ? 'text-primary-600' : 'text-gray-500'}`} />
                Inbjudningar
              </Link>
            </>
          )}
        </nav>

        {/* User info and logout at bottom */}
        <div className="border-t border-gray-200">
          {/* Company Selector */}
          <div className="p-4">
            <div className="text-xs font-semibold text-gray-500 uppercase mb-2">
              Företag
            </div>
            <CompanySelector
              selectedCompanyId={selectedCompany?.id || null}
              onCompanyChange={setSelectedCompany}
            />
          </div>

          {/* User info and logout button */}
          <div className="p-4 border-t border-gray-200">
            <div className="flex items-center mb-3">
              <div className="flex-shrink-0">
                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                  <User className="w-5 h-5 text-blue-600" />
                </div>
              </div>
              <div className="ml-3 flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{user?.full_name}</p>
                <p className="text-xs text-gray-500 truncate">{user?.email}</p>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="w-full flex items-center justify-center px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
            >
              <LogOut className="w-4 h-4 mr-2" />
              Logga ut
            </button>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <main className="flex-1 overflow-y-auto p-6">
          <div className="max-w-7xl mx-auto">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/invoices" element={<Invoices />} />
              <Route path="/invoices/:invoiceId" element={<InvoiceDetail />} />
              <Route path="/supplier-invoices/:invoiceId" element={<SupplierInvoiceDetail />} />
              <Route path="/expenses" element={<Expenses />} />
              <Route path="/expenses/:expenseId" element={<ExpenseDetail />} />
              <Route path="/verifications" element={<Verifications />} />
              <Route path="/verifications/:verificationId" element={<VerificationDetail />} />
              <Route path="/customers" element={<Customers />} />
              <Route path="/accounts" element={<Accounts />} />
              <Route path="/accounts/:accountId/ledger" element={<AccountLedger />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="/users" element={<UsersPage />} />
              <Route path="/invitations" element={<InvitationsPage />} />
            </Routes>
          </div>
        </main>
      </div>

      {/* AI Assistant */}
      {aiEnabled && <ChatFAB onClick={() => setIsChatOpen(!isChatOpen)} />}
      <ChatPanel isOpen={isChatOpen} onClose={() => setIsChatOpen(false)} />
    </div>
  )
}

export default App
