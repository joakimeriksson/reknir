import { useState, useEffect } from 'react'
import { Users as UsersIcon, Plus, Building2, Trash2, Bot, RefreshCw, Copy, Eye, EyeOff, KeyRound, UserX, UserCheck } from 'lucide-react'
import api from '../services/api'
import { getErrorMessage } from '../utils/errors'
import { useToast } from '@/contexts/ToastContext'
import { useAuth } from '@/contexts/AuthContext'
import { authService } from '../services/authService'
import type { PasswordResetLink } from '../types/auth'

interface User {
  id: number
  email: string
  full_name: string
  is_admin: boolean
  is_active: boolean
  is_service_account?: boolean
  created_at: string
}

interface ServiceAccount {
  id: number
  full_name: string
  email: string
  is_admin: boolean
  is_active: boolean
  is_service_account: boolean
  owner_id: number | null
  created_at: string
}

interface Company {
  id: number
  name: string
}

export default function Users() {
  const [users, setUsers] = useState<User[]>([])
  const { showToast } = useToast()
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [showCompanyModal, setShowCompanyModal] = useState(false)
  const [userCompanies, setUserCompanies] = useState<Company[]>([])

  // Form states
  const [newUser, setNewUser] = useState({
    email: '',
    full_name: '',
    password: ''
  })
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | null>(null)
  const [selectedRole, setSelectedRole] = useState('user')

  // Service account states
  const [serviceAccounts, setServiceAccounts] = useState<ServiceAccount[]>([])
  const [showCreateBotModal, setShowCreateBotModal] = useState(false)
  const [newBotName, setNewBotName] = useState('')
  const [createdApiKey, setCreatedApiKey] = useState<string | null>(null)
  const [showApiKey, setShowApiKey] = useState(false)
  const [rotatedApiKey, setRotatedApiKey] = useState<{ id: number; key: string } | null>(null)
  const [resetLink, setResetLink] = useState<{ user: User; link: PasswordResetLink } | null>(null)
  const [linkCopied, setLinkCopied] = useState(false)
  const { user: currentUser } = useAuth()

  useEffect(() => {
    loadUsers()
    loadCompanies()
    loadServiceAccounts()
  }, [])

  const loadUsers = async () => {
    try {
      const response = await api.get('/auth/users')
      setUsers(response.data)
    } catch (error) {
      console.error('Failed to load users:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadCompanies = async () => {
    try {
      const response = await api.get('/auth/me/companies')
      setCompanies(response.data)
    } catch (error) {
      console.error('Failed to load companies:', error)
    }
  }

  const loadUserCompanies = async (userId: number) => {
    try {
      const response = await api.get(`/auth/users/${userId}/companies`)
      setUserCompanies(response.data)
    } catch (error) {
      console.error('Failed to load user companies:', error)
    }
  }

  const loadServiceAccounts = async () => {
    try {
      const response = await api.get('/auth/service-accounts')
      setServiceAccounts(response.data)
    } catch (error) {
      console.error('Failed to load service accounts:', error)
    }
  }

  const handleCreateServiceAccount = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      const response = await api.post('/auth/service-accounts', { full_name: newBotName })
      setCreatedApiKey(response.data.api_key)
      setShowApiKey(true)
      setNewBotName('')
      loadServiceAccounts()
    } catch (error) {
      alert(getErrorMessage(error, 'Kunde inte skapa bot-konto'))
    }
  }

  const handleDeactivateServiceAccount = async (id: number) => {
    if (!confirm('Är du säker på att du vill inaktivera detta bot-konto?')) return
    try {
      await api.delete(`/auth/service-accounts/${id}`)
      loadServiceAccounts()
    } catch (error) {
      alert(getErrorMessage(error, 'Kunde inte inaktivera bot-konto'))
    }
  }

  const handleRotateKey = async (id: number) => {
    if (!confirm('Är du säker? Den gamla API-nyckeln slutar fungera omedelbart.')) return
    try {
      const response = await api.post(`/auth/service-accounts/${id}/rotate-key`)
      setRotatedApiKey({ id, key: response.data.api_key })
    } catch (error) {
      alert(getErrorMessage(error, 'Kunde inte rotera API-nyckel'))
    }
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await api.post('/auth/users', newUser)
      setShowCreateModal(false)
      setNewUser({ email: '', full_name: '', password: '' })
      loadUsers()
    } catch (error) {
      showToast(getErrorMessage(error, 'Failed to create user'), 'error')
    }
  }

  const handleCreateResetLink = async (user: User) => {
    try {
      const link = await authService.createResetLink(user.id)
      setLinkCopied(false)
      setResetLink({ user, link })
    } catch (error) {
      showToast(getErrorMessage(error, 'Kunde inte skapa återställningslänk'), 'error')
    }
  }

  const handleToggleActive = async (user: User) => {
    const verb = user.is_active ? 'inaktivera' : 'aktivera'
    if (!confirm(`Vill du ${verb} ${user.full_name}?`)) return
    try {
      await authService.adminUpdateUser(user.id, { is_active: !user.is_active })
      loadUsers()
    } catch (error) {
      showToast(getErrorMessage(error, `Kunde inte ${verb} användaren`), 'error')
    }
  }

  const resetUrl = resetLink ? `${window.location.origin}${resetLink.link.path}` : ''

  const handleGrantAccess = async () => {
    if (!selectedUser || !selectedCompanyId) return

    try {
      await api.post(
        `/auth/users/${selectedUser.id}/companies/${selectedCompanyId}`,
        { role: selectedRole }
      )
      loadUserCompanies(selectedUser.id)
      setSelectedCompanyId(null)
    } catch (error) {
      showToast(getErrorMessage(error, 'Failed to grant access'), 'error')
    }
  }

  const handleRevokeAccess = async (userId: number, companyId: number) => {
    if (!confirm('Är du säker på att du vill ta bort åtkomst till detta företag?')) return

    try {
      await api.delete(`/auth/users/${userId}/companies/${companyId}`)
      if (selectedUser) {
        loadUserCompanies(selectedUser.id)
      }
    } catch (error) {
      showToast(getErrorMessage(error, 'Failed to revoke access'), 'error')
    }
  }

  const openCompanyModal = async (user: User) => {
    setSelectedUser(user)
    await loadUserCompanies(user.id)
    setShowCompanyModal(true)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">Laddar användare...</div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Användare</h1>
          <p className="text-gray-500 mt-1">Hantera användare och deras företagsbehörigheter</p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700"
        >
          <Plus className="w-5 h-5" />
          Ny användare
        </button>
      </div>

      {/* Users Table */}
      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Användare
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                E-post
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Roll
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Status
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                Åtgärder
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {users.map((user) => (
              <tr key={user.id}>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <div className="flex-shrink-0 h-10 w-10 bg-blue-100 rounded-full flex items-center justify-center">
                      <UsersIcon className="h-5 w-5 text-blue-600" />
                    </div>
                    <div className="ml-4">
                      <div className="text-sm font-medium text-gray-900">{user.full_name}</div>
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {user.email}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span
                    className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                      user.is_admin
                        ? 'bg-purple-100 text-purple-800'
                        : 'bg-gray-100 text-gray-800'
                    }`}
                  >
                    {user.is_admin ? 'Admin' : 'Användare'}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <span
                    className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                      user.is_active
                        ? 'bg-green-100 text-green-800'
                        : 'bg-red-100 text-red-800'
                    }`}
                  >
                    {user.is_active ? 'Aktiv' : 'Inaktiv'}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                  <div className="flex items-center gap-4">
                    <button
                      onClick={() => openCompanyModal(user)}
                      className="text-blue-600 hover:text-blue-900 flex items-center gap-1"
                    >
                      <Building2 className="w-4 h-4" />
                      Hantera företag
                    </button>
                    <button
                      onClick={() => handleCreateResetLink(user)}
                      disabled={!user.is_active}
                      title="Skapa en engångslänk för att sätta nytt lösenord"
                      className="text-amber-700 hover:text-amber-900 flex items-center gap-1 disabled:opacity-40"
                    >
                      <KeyRound className="w-4 h-4" />
                      Återställningslänk
                    </button>
                    {user.id !== currentUser?.id && (
                      <button
                        onClick={() => handleToggleActive(user)}
                        className={`flex items-center gap-1 ${
                          user.is_active ? 'text-red-600 hover:text-red-800' : 'text-green-700 hover:text-green-900'
                        }`}
                      >
                        {user.is_active ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                        {user.is_active ? 'Inaktivera' : 'Aktivera'}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Reset link modal */}
      {resetLink && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-lg">
            <h2 className="text-xl font-bold mb-2 flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-amber-700" />
              Återställningslänk för {resetLink.user.full_name}
            </h2>
            <p className="text-sm text-gray-600 mb-4">
              Reknir skickar ingen e-post. Kopiera länken och ge den till användaren på ett sätt du litar på.
              Den gäller till {new Date(resetLink.link.expires_at + 'Z').toLocaleString('sv-SE')} och kan bara användas en gång.
            </p>
            <div className="flex items-center gap-2 bg-gray-50 border rounded p-3">
              <code className="text-xs break-all flex-1">{resetUrl}</code>
              <button
                onClick={() => {
                  copyToClipboard(resetUrl)
                  setLinkCopied(true)
                }}
                className="p-2 text-gray-600 hover:text-gray-900"
                title="Kopiera"
              >
                <Copy className="w-4 h-4" />
              </button>
            </div>
            {linkCopied && <p className="text-xs text-green-700 mt-2">Kopierad till urklipp</p>}
            <div className="flex justify-end mt-6">
              <button onClick={() => setResetLink(null)} className="px-4 py-2 bg-gray-100 rounded-lg hover:bg-gray-200">
                Stäng
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Service Accounts Section */}
      <div className="flex items-center justify-between mt-10">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Bot-konton</h2>
          <p className="text-gray-500 mt-1">Hantera bot-användare för automatisering (t.ex. MCP)</p>
        </div>
        <button
          onClick={() => setShowCreateBotModal(true)}
          className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700"
        >
          <Bot className="w-5 h-5" />
          Skapa bot-konto
        </button>
      </div>

      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Bot</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Skapad</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Åtgärder</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {serviceAccounts.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-6 py-8 text-center text-gray-500">
                  Inga bot-konton skapade ännu.
                </td>
              </tr>
            ) : (
              serviceAccounts.map((sa) => (
                <tr key={sa.id}>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center">
                      <div className="flex-shrink-0 h-10 w-10 bg-emerald-100 rounded-full flex items-center justify-center">
                        <Bot className="h-5 w-5 text-emerald-600" />
                      </div>
                      <div className="ml-4">
                        <div className="text-sm font-medium text-gray-900">{sa.full_name}</div>
                        <div className="text-xs text-gray-400">ID: {sa.id}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {new Date(sa.created_at).toLocaleDateString('sv-SE')}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span
                      className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        sa.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                      }`}
                    >
                      {sa.is_active ? 'Aktiv' : 'Inaktiv'}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => openCompanyModal(sa as unknown as User)}
                        className="text-blue-600 hover:text-blue-900 flex items-center gap-1"
                      >
                        <Building2 className="w-4 h-4" />
                        Företag
                      </button>
                      <button
                        onClick={() => handleRotateKey(sa.id)}
                        className="text-amber-600 hover:text-amber-900 flex items-center gap-1"
                      >
                        <RefreshCw className="w-4 h-4" />
                        Rotera nyckel
                      </button>
                      {sa.is_active && (
                        <button
                          onClick={() => handleDeactivateServiceAccount(sa.id)}
                          className="text-red-600 hover:text-red-900 flex items-center gap-1"
                        >
                          <Trash2 className="w-4 h-4" />
                          Inaktivera
                        </button>
                      )}
                    </div>
                    {rotatedApiKey && rotatedApiKey.id === sa.id && (
                      <div className="mt-2 p-2 bg-amber-50 border border-amber-200 rounded-lg">
                        <p className="text-xs text-amber-800 font-medium mb-1">Ny API-nyckel (visas bara en gång):</p>
                        <div className="flex items-center gap-2">
                          <code className="text-xs bg-amber-100 px-2 py-1 rounded flex-1 break-all">
                            {rotatedApiKey.key}
                          </code>
                          <button
                            onClick={() => copyToClipboard(rotatedApiKey.key)}
                            className="text-amber-700 hover:text-amber-900"
                          >
                            <Copy className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Create Bot Account Modal */}
      {showCreateBotModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            {createdApiKey ? (
              <>
                <h2 className="text-xl font-bold mb-4 text-emerald-700">Bot-konto skapat!</h2>
                <div className="bg-amber-50 border border-amber-300 rounded-lg p-4 mb-4">
                  <p className="text-sm text-amber-800 font-medium mb-2">
                    Kopiera API-nyckeln nu. Den visas bara en gång!
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="text-sm bg-white px-3 py-2 rounded border flex-1 break-all">
                      {showApiKey ? createdApiKey : '••••••••••••••••••••••••'}
                    </code>
                    <button
                      onClick={() => setShowApiKey(!showApiKey)}
                      className="text-gray-600 hover:text-gray-800"
                    >
                      {showApiKey ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                    <button
                      onClick={() => copyToClipboard(createdApiKey)}
                      className="text-gray-600 hover:text-gray-800"
                    >
                      <Copy className="w-5 h-5" />
                    </button>
                  </div>
                </div>
                <p className="text-sm text-gray-600 mb-4">
                  Glöm inte att ge bot-kontot åtkomst till rätt företag via "Företag"-knappen.
                </p>
                <button
                  onClick={() => {
                    setShowCreateBotModal(false)
                    setCreatedApiKey(null)
                    setShowApiKey(false)
                  }}
                  className="w-full bg-gray-200 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-300"
                >
                  Stäng
                </button>
              </>
            ) : (
              <>
                <h2 className="text-xl font-bold mb-4">Skapa bot-konto</h2>
                <form onSubmit={handleCreateServiceAccount} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Namn
                    </label>
                    <input
                      type="text"
                      value={newBotName}
                      onChange={(e) => setNewBotName(e.target.value)}
                      placeholder="t.ex. MCP Bot"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                      required
                    />
                    <p className="text-xs text-gray-500 mt-1">
                      Ett beskrivande namn som visas i granskningsloggen.
                    </p>
                  </div>
                  <div className="flex gap-3 mt-6">
                    <button
                      type="submit"
                      className="flex-1 bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700"
                    >
                      Skapa
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowCreateBotModal(false)}
                      className="flex-1 bg-gray-200 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-300"
                    >
                      Avbryt
                    </button>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      )}

      {/* Create User Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">Skapa ny användare</h2>
            <form onSubmit={handleCreateUser} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Namn
                </label>
                <input
                  type="text"
                  value={newUser.full_name}
                  onChange={(e) => setNewUser({ ...newUser, full_name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  E-post
                </label>
                <input
                  type="email"
                  value={newUser.email}
                  onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Lösenord
                </label>
                <input
                  type="password"
                  value={newUser.password}
                  onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                  required
                  minLength={6}
                />
              </div>
              <div className="flex gap-3 mt-6">
                <button
                  type="submit"
                  className="flex-1 bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700"
                >
                  Skapa
                </button>
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="flex-1 bg-gray-200 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-300"
                >
                  Avbryt
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manage Companies Modal */}
      {showCompanyModal && selectedUser && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-2xl">
            <h2 className="text-xl font-bold mb-4">
              Företagsbehörigheter för {selectedUser.full_name}
            </h2>

            {selectedUser.is_admin ? (
              <div className="bg-primary-50 border border-primary-200 rounded-lg p-4 mb-4">
                <p className="text-primary-800">
                  <strong>Admin-användare</strong> har automatiskt åtkomst till alla företag.
                </p>
              </div>
            ) : (
              <>
                {/* User's Companies */}
                <div className="mb-6">
                  <h3 className="text-sm font-medium text-gray-700 mb-2">Nuvarande företag</h3>
                  {userCompanies.length === 0 ? (
                    <p className="text-gray-500 text-sm">Användaren har ingen företagsbehörighet än.</p>
                  ) : (
                    <div className="space-y-2">
                      {userCompanies.map((company) => (
                        <div
                          key={company.id}
                          className="flex items-center justify-between bg-gray-50 p-3 rounded-lg"
                        >
                          <div className="flex items-center gap-2">
                            <Building2 className="w-4 h-4 text-gray-500" />
                            <span className="text-sm font-medium">{company.name}</span>
                          </div>
                          <button
                            onClick={() => handleRevokeAccess(selectedUser.id, company.id)}
                            className="text-red-600 hover:text-red-800"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Add Company Access */}
                <div>
                  <h3 className="text-sm font-medium text-gray-700 mb-2">Lägg till företag</h3>
                  <div className="flex gap-2">
                    <select
                      value={selectedCompanyId || ''}
                      onChange={(e) => setSelectedCompanyId(Number(e.target.value))}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg"
                    >
                      <option value="">Välj företag...</option>
                      {companies
                        .filter((c) => !userCompanies.find((uc) => uc.id === c.id))
                        .map((company) => (
                          <option key={company.id} value={company.id}>
                            {company.name}
                          </option>
                        ))}
                    </select>
                    <select
                      value={selectedRole}
                      onChange={(e) => setSelectedRole(e.target.value)}
                      className="px-3 py-2 border border-gray-300 rounded-lg"
                    >
                      <option value="user">Användare</option>
                      <option value="accountant">Redovisare</option>
                      <option value="manager">Chef</option>
                    </select>
                    <button
                      onClick={handleGrantAccess}
                      disabled={!selectedCompanyId}
                      className="bg-primary-600 text-white px-4 py-2 rounded-lg hover:bg-primary-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
                    >
                      Lägg till
                    </button>
                  </div>
                </div>
              </>
            )}

            <div className="flex justify-end mt-6">
              <button
                onClick={() => {
                  setShowCompanyModal(false)
                  setSelectedUser(null)
                  setUserCompanies([])
                }}
                className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-300"
              >
                Stäng
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
