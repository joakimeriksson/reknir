import { useEffect, useState } from 'react'
import { backupApi } from '@/services/api'
import type { BackupInfo, BackupScheduleResponse } from '@/types'
import { Clock, Download, HardDrive, Loader2, RotateCcw, Save, Trash2 } from 'lucide-react'
import RestoreModal from '@/components/RestoreModal'
import { useToast } from '@/contexts/ToastContext'

export default function BackupSettings() {
  const { showToast } = useToast()
  const [backups, setBackups] = useState<BackupInfo[]>([])
  const [loadingBackups, setLoadingBackups] = useState(false)
  const [creatingBackup, setCreatingBackup] = useState(false)
  const [downloadingBackup, setDownloadingBackup] = useState<string | null>(null)
  const [showRestoreModal, setShowRestoreModal] = useState(false)
  const [schedule, setSchedule] = useState<BackupScheduleResponse | null>(null)
  const [scheduleForm, setScheduleForm] = useState({ enabled: false, interval_hours: 24, max_backups: 30, preferred_time: '03:00' })
  const [savingSchedule, setSavingSchedule] = useState(false)
  const [deletingBackup, setDeletingBackup] = useState<string | null>(null)
  const [backupToDelete, setBackupToDelete] = useState<string | null>(null)

  useEffect(() => {
    loadBackups()
    loadSchedule()
  }, [])

  const loadBackups = async () => {
    setLoadingBackups(true)
    try {
      const response = await backupApi.list()
      setBackups(response.data)
    } catch (error: any) {
      console.error('Failed to load backups:', error)
      showToast('Kunde inte ladda backups', 'error')
    } finally {
      setLoadingBackups(false)
    }
  }

  const handleCreateBackup = async () => {
    setCreatingBackup(true)
    try {
      await backupApi.create()
      showToast('Backup skapad!', 'success')
      loadBackups()
    } catch (error: any) {
      console.error('Backup creation failed:', error)
      showToast(error.response?.data?.detail || 'Kunde inte skapa backup', 'error')
    } finally {
      setCreatingBackup(false)
    }
  }

  const handleDeleteBackup = async () => {
    if (!backupToDelete) return
    setDeletingBackup(backupToDelete)
    try {
      await backupApi.delete(backupToDelete)
      showToast('Backup raderad', 'success')
      loadBackups()
    } catch (error: any) {
      showToast(error.response?.data?.detail || 'Kunde inte radera backup', 'error')
    } finally {
      setDeletingBackup(null)
      setBackupToDelete(null)
    }
  }

  const loadSchedule = async () => {
    try {
      const response = await backupApi.getSchedule()
      setSchedule(response.data)
      setScheduleForm({
        enabled: response.data.enabled,
        interval_hours: response.data.interval_hours,
        max_backups: response.data.max_backups,
        preferred_time: utcTimeToLocal(response.data.preferred_time),
      })
    } catch (error: any) {
      console.error('Failed to load schedule:', error)
    }
  }

  const handleSaveSchedule = async () => {
    setSavingSchedule(true)
    try {
      const payload = { ...scheduleForm, preferred_time: localTimeToUtc(scheduleForm.preferred_time) }
      const response = await backupApi.updateSchedule(payload)
      setSchedule(response.data)
      showToast('Schemaläggning sparad!', 'success')
    } catch (error: any) {
      showToast(error.response?.data?.detail || 'Kunde inte spara schemaläggning', 'error')
    } finally {
      setSavingSchedule(false)
    }
  }

  const handleDownloadBackup = async (filename: string) => {
    setDownloadingBackup(filename)
    try {
      const response = await backupApi.download(filename)

      const blob = new Blob([response.data], { type: 'application/gzip' })
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      document.body.removeChild(a)

      showToast('Backup nedladdad', 'success')
    } catch (error: any) {
      console.error('Backup download failed:', error)
      showToast('Kunde inte ladda ner backup', 'error')
    } finally {
      setDownloadingBackup(null)
    }
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const formatBackupDate = (dateString: string): string => {
    return new Date(dateString).toLocaleString('sv-SE', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    })
  }

  // Convert "HH:MM" in UTC to "HH:MM" in the browser's local timezone
  const utcTimeToLocal = (utcTime: string): string => {
    const [h, m] = utcTime.split(':').map(Number)
    const d = new Date()
    d.setUTCHours(h, m, 0, 0)
    return d.toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
  }

  // Convert "HH:MM" in the browser's local timezone to "HH:MM" in UTC
  const localTimeToUtc = (localTime: string): string => {
    const [h, m] = localTime.split(':').map(Number)
    const d = new Date()
    d.setHours(h, m, 0, 0)
    return d.toISOString().slice(11, 16)
  }

  return (
    <>
      <div className="card mb-6">
        <div className="flex items-center gap-2 mb-4">
          <HardDrive className="w-5 h-5 text-gray-600" />
          <h2 className="text-xl font-semibold">Systembackup</h2>
        </div>
        <p className="text-gray-600 mb-4">
          Skapa fullständiga backups av hela systemet: hela databasen med alla företag, användare och
          inställningar, samt alla bilagor, fakturor, kvitton och logotyper. En backup kan återställas i samma
          eller en senare version av Reknir; databasen uppgraderas automatiskt vid återställningen.
        </p>

        {/* Create Backup */}
        <div className="mb-6">
          <button
            onClick={handleCreateBackup}
            disabled={creatingBackup}
            className="btn btn-primary inline-flex items-center"
          >
            {creatingBackup ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Skapar backup...
              </>
            ) : (
              <>
                <HardDrive className="w-4 h-4 mr-2" />
                Skapa backup
              </>
            )}
          </button>
        </div>

        {/* Schedule Section */}
        <div className="border-t pt-4 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="w-4 h-4 text-gray-600" />
            <h3 className="text-sm font-medium text-gray-700">Automatisk backup</h3>
          </div>

          <div className="space-y-4">
            {/* Enable toggle */}
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={scheduleForm.enabled}
                onChange={(e) => setScheduleForm(prev => ({ ...prev, enabled: e.target.checked }))}
                className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              <span className="text-sm text-gray-700">Aktivera schemalagd backup</span>
            </label>

            {/* Interval and max backups */}
            <div className="flex flex-wrap gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Intervall</label>
                <select
                  value={scheduleForm.interval_hours}
                  onChange={(e) => setScheduleForm(prev => ({ ...prev, interval_hours: Number(e.target.value) }))}
                  disabled={!scheduleForm.enabled}
                  className="input text-sm w-44 disabled:opacity-50"
                >
                  <option value={6}>Var 6:e timme</option>
                  <option value={24}>Varje dygn</option>
                  <option value={48}>Varannan dag</option>
                  <option value={168}>Varje vecka</option>
                  <option value={336}>Varannan vecka</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Tid</label>
                <input
                  type="time"
                  value={scheduleForm.preferred_time}
                  onChange={(e) => setScheduleForm(prev => ({ ...prev, preferred_time: e.target.value }))}
                  disabled={!scheduleForm.enabled}
                  className="input text-sm w-28 disabled:opacity-50"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Behåll senaste</label>
                <input
                  type="number"
                  min={1}
                  value={scheduleForm.max_backups}
                  onChange={(e) => setScheduleForm(prev => ({ ...prev, max_backups: Math.max(1, Number(e.target.value)) }))}
                  disabled={!scheduleForm.enabled}
                  className="input text-sm w-24 disabled:opacity-50"
                />
              </div>
            </div>

            {/* Status */}
            {schedule && schedule.enabled && (
              <div className="text-xs text-gray-500 space-y-1">
                {schedule.last_backup_at && (
                  <p>Senaste backup: {formatBackupDate(schedule.last_backup_at)}</p>
                )}
                {schedule.next_backup_at && (
                  <p>Nästa backup: {formatBackupDate(schedule.next_backup_at)}</p>
                )}
              </div>
            )}

            {/* Save button */}
            <button
              onClick={handleSaveSchedule}
              disabled={savingSchedule}
              className="btn btn-secondary inline-flex items-center text-sm"
            >
              {savingSchedule ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Sparar...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  Spara inställningar
                </>
              )}
            </button>
          </div>
        </div>

        {/* Backup List */}
        <div className="border-t pt-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-gray-700">Backups på servern</h3>
            <button
              onClick={loadBackups}
              disabled={loadingBackups}
              className="text-sm text-blue-600 hover:text-blue-800"
            >
              {loadingBackups ? 'Laddar...' : 'Uppdatera'}
            </button>
          </div>

          {loadingBackups ? (
            <div className="text-center py-4 text-gray-500">
              <Loader2 className="w-6 h-6 mx-auto mb-2 animate-spin" />
              Laddar backups...
            </div>
          ) : backups.length === 0 ? (
            <div className="text-center py-4 text-gray-500">
              <p>Inga backups på servern.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Skapad</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Version</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Schema</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Storlek</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">Åtgärder</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {backups.map((backup) => (
                    <tr key={backup.filename} className="hover:bg-gray-50">
                      <td className="px-3 py-2 text-sm text-gray-900">
                        {formatBackupDate(backup.created_at)}
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-600">
                        {backup.app_version}
                        {backup.format === 'json' && (
                          <span className="ml-1 text-xs text-amber-600" title="Portabelt JSON-arkiv">(JSON)</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-600">{backup.schema_version}</td>
                      <td className="px-3 py-2 text-sm text-gray-600">
                        {formatFileSize(backup.size_bytes)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleDownloadBackup(backup.filename)}
                            disabled={downloadingBackup === backup.filename}
                            className="text-blue-600 hover:text-blue-800 p-1"
                            title="Ladda ner"
                          >
                            {downloadingBackup === backup.filename ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Download className="w-4 h-4" />
                            )}
                          </button>
                          <button
                            onClick={() => setBackupToDelete(backup.filename)}
                            disabled={deletingBackup === backup.filename}
                            className="text-red-600 hover:text-red-800 p-1"
                            title="Radera"
                          >
                            {deletingBackup === backup.filename ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <Trash2 className="w-4 h-4" />
                            )}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Restore Button */}
        <div className="border-t mt-4 pt-4">
          <button
            onClick={() => setShowRestoreModal(true)}
            className="btn btn-secondary inline-flex items-center"
          >
            <RotateCcw className="w-4 h-4 mr-2" />
            Återställ från backup
          </button>
          <p className="mt-2 text-sm text-gray-500">
            Återställ systemet från en backup på servern eller ladda upp en backup-fil.
          </p>
        </div>

        <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded">
          <p className="text-sm text-amber-800">
            <strong>Varning:</strong> Återställning ersätter ALL data i systemet. Skapa alltid en backup
            av nuvarande data innan du återställer.
          </p>
        </div>
      </div>

      {backupToDelete && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 overflow-hidden">
            <div className="bg-gradient-to-r from-red-500 to-red-600 px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="bg-white bg-opacity-20 p-2 rounded-full">
                  <Trash2 className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-xl font-semibold text-white">Radera backup</h3>
              </div>
            </div>
            <div className="px-6 py-5">
              <p className="text-gray-700 mb-3">
                Är du säker på att du vill radera följande backup?
              </p>
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <p className="font-mono text-sm text-gray-900">{backupToDelete}</p>
              </div>
              <p className="text-sm text-red-600 mt-3">
                Denna åtgärd kan inte ångras.
              </p>
            </div>
            <div className="bg-gray-50 px-6 py-4 flex gap-3 justify-end">
              <button
                onClick={() => setBackupToDelete(null)}
                disabled={!!deletingBackup}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors disabled:opacity-50"
              >
                Avbryt
              </button>
              <button
                onClick={handleDeleteBackup}
                disabled={!!deletingBackup}
                className="px-4 py-2 text-sm font-medium text-white bg-red-600 border border-transparent rounded-lg hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {deletingBackup ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Raderar...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    Radera
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <RestoreModal
        isOpen={showRestoreModal}
        onClose={() => setShowRestoreModal(false)}
        backups={backups}
      />
    </>
  )
}
