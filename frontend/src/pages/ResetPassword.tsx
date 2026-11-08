import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { KeyRound, Loader2, AlertCircle, CheckCircle } from 'lucide-react'
import { authService } from '../services/authService'
import type { PasswordResetValidation } from '../types/auth'
import { getErrorMessage } from '../utils/errors'

const inputClass =
  'appearance-none block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm'

export default function ResetPassword() {
  const { token } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const [validation, setValidation] = useState<PasswordResetValidation | null>(null)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    if (!token) return
    authService
      .validateResetToken(token)
      .then(setValidation)
      .catch(() => setValidation({ valid: false, message: 'Kunde inte kontrollera länken' }))
  }, [token])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (password.length < 8) {
      setError('Lösenordet måste vara minst 8 tecken')
      return
    }
    if (password !== confirm) {
      setError('Lösenorden matchar inte')
      return
    }
    if (!token) return
    setSubmitting(true)
    try {
      await authService.completePasswordReset(token, password)
      setDone(true)
      setTimeout(() => navigate('/login'), 2500)
    } catch (err) {
      setError(getErrorMessage(err, 'Kunde inte byta lösenord'))
    } finally {
      setSubmitting(false)
    }
  }

  let body: React.ReactNode
  if (!validation) {
    body = (
      <div className="flex justify-center py-8">
        <Loader2 className="h-8 w-8 text-blue-600 animate-spin" />
      </div>
    )
  } else if (done) {
    body = (
      <div className="text-center py-6">
        <CheckCircle className="h-12 w-12 text-green-600 mx-auto mb-3" />
        <p className="text-gray-900 font-medium">Lösenordet är bytt</p>
        <p className="text-sm text-gray-500 mt-1">Du skickas till inloggningen...</p>
      </div>
    )
  } else if (!validation.valid) {
    body = (
      <div className="text-center py-6">
        <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-3" />
        <p className="text-gray-900 font-medium">{validation.message || 'Länken är ogiltig'}</p>
        <p className="text-sm text-gray-500 mt-2">
          Länkar gäller i 24 timmar och kan bara användas en gång. Be en administratör om en ny.
        </p>
        <button onClick={() => navigate('/login')} className="mt-6 text-sm text-blue-600 hover:text-blue-800">
          Till inloggningen
        </button>
      </div>
    )
  } else {
    body = (
      <form className="space-y-5" onSubmit={handleSubmit}>
        <p className="text-sm text-gray-600">
          Nytt lösenord för <span className="font-medium text-gray-900">{validation.email}</span>
        </p>
        {error && <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm">{error}</div>}
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-gray-700">
            Nytt lösenord
          </label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`mt-1 ${inputClass}`}
          />
          <p className="mt-1 text-xs text-gray-500">Minst 8 tecken.</p>
        </div>
        <div>
          <label htmlFor="confirm" className="block text-sm font-medium text-gray-700">
            Bekräfta lösenord
          </label>
          <input
            id="confirm"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className={`mt-1 ${inputClass}`}
          />
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="w-full flex justify-center py-2 px-4 rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
        >
          {submitting ? 'Byter lösenord...' : 'Byt lösenord'}
        </button>
      </form>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center">
          <div className="bg-blue-600 p-3 rounded-lg">
            <KeyRound className="h-12 w-12 text-white" />
          </div>
        </div>
        <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">Återställ lösenord</h2>
      </div>
      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">{body}</div>
      </div>
    </div>
  )
}
