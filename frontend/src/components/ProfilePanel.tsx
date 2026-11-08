import { useState } from 'react'
import { UserCog, KeyRound, Save } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { authService } from '@/services/authService'
import { getErrorMessage } from '@/utils/errors'

const inputClass = 'w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-primary-500 focus:border-primary-500'

/**
 * "Mitt konto": lets the signed-in user change their name, e-mail and password.
 * E-mail and password changes require the current password.
 */
export default function ProfilePanel() {
  const { user, refreshUser } = useAuth()
  const { showToast } = useToast()

  const [fullName, setFullName] = useState(user?.full_name ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [profilePassword, setProfilePassword] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)

  if (!user) return null

  const emailChanged = email.trim() !== user.email
  const nameChanged = fullName.trim() !== user.full_name

  const handleProfileSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!nameChanged && !emailChanged) return
    if (emailChanged && !profilePassword) {
      showToast('Ange nuvarande lösenord för att byta e-postadress', 'error')
      return
    }
    setSavingProfile(true)
    try {
      await authService.updateProfile({
        ...(nameChanged ? { full_name: fullName.trim() } : {}),
        ...(emailChanged ? { email: email.trim(), current_password: profilePassword } : {}),
      })
      await refreshUser()
      setProfilePassword('')
      showToast('Kontouppgifterna är sparade', 'success')
    } catch (err) {
      showToast(getErrorMessage(err, 'Kunde inte spara'), 'error')
    } finally {
      setSavingProfile(false)
    }
  }

  const handlePasswordSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (newPassword.length < 8) {
      showToast('Det nya lösenordet måste vara minst 8 tecken', 'error')
      return
    }
    if (newPassword !== confirmPassword) {
      showToast('Lösenorden matchar inte', 'error')
      return
    }
    setSavingPassword(true)
    try {
      await authService.updateProfile({ password: newPassword, current_password: currentPassword })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      showToast('Lösenordet är bytt', 'success')
    } catch (err) {
      showToast(getErrorMessage(err, 'Kunde inte byta lösenord'), 'error')
    } finally {
      setSavingPassword(false)
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <form onSubmit={handleProfileSave} className="card">
        <h2 className="text-xl font-semibold flex items-center gap-2 mb-4">
          <UserCog className="w-5 h-5" />
          Kontouppgifter
        </h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Namn</label>
            <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} className={inputClass} required />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">E-postadress</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} required />
            <p className="mt-1 text-xs text-gray-500">E-postadressen är ditt användarnamn vid inloggning.</p>
          </div>
          {emailChanged && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nuvarande lösenord</label>
              <input
                type="password"
                autoComplete="current-password"
                value={profilePassword}
                onChange={(e) => setProfilePassword(e.target.value)}
                className={inputClass}
                required
              />
              <p className="mt-1 text-xs text-gray-500">Krävs för att byta e-postadress.</p>
            </div>
          )}
          <div className="flex items-center justify-between pt-2">
            <span className="text-xs text-gray-500">
              {user.is_admin ? 'Administratör' : 'Användare'} · konto skapat {new Date(user.created_at).toLocaleDateString('sv-SE')}
            </span>
            <button
              type="submit"
              disabled={savingProfile || (!nameChanged && !emailChanged)}
              className="btn-primary flex items-center gap-2 disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {savingProfile ? 'Sparar...' : 'Spara'}
            </button>
          </div>
        </div>
      </form>

      <form onSubmit={handlePasswordSave} className="card">
        <h2 className="text-xl font-semibold flex items-center gap-2 mb-4">
          <KeyRound className="w-5 h-5" />
          Byt lösenord
        </h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nuvarande lösenord</label>
            <input
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className={inputClass}
              required
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nytt lösenord</label>
              <input
                type="password"
                autoComplete="new-password"
                minLength={8}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className={inputClass}
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Bekräfta nytt lösenord</label>
              <input
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={inputClass}
                required
              />
            </div>
          </div>
          <p className="text-xs text-gray-500">Minst 8 tecken. Glömt lösenordet? En administratör kan skapa en återställningslänk under Användare.</p>
          <div className="flex justify-end">
            <button type="submit" disabled={savingPassword} className="btn-primary flex items-center gap-2 disabled:opacity-50">
              <KeyRound className="w-4 h-4" />
              {savingPassword ? 'Byter...' : 'Byt lösenord'}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}
