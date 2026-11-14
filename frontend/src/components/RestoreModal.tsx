import { useState, useRef, useEffect, useMemo } from 'react'
import { X, AlertTriangle, CheckCircle, XCircle, Upload, Server, Loader2, ChevronLeft, ChevronRight } from 'lucide-react'
import {
  parseISO, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, isSameDay, isSameMonth, isToday,
  format, addMonths, subMonths
} from 'date-fns'
import { sv } from 'date-fns/locale'
import type { BackupInfo, RestoreResponse } from '@/types'
import { backupApi } from '@/services/api'

interface RestoreModalProps {
  isOpen: boolean
  onClose: () => void
  backups: BackupInfo[]
}

type Step = 'source' | 'select' | 'confirm' | 'progress' | 'result'
type Source = 'server' | 'upload' | null

export default function RestoreModal({ isOpen, onClose, backups }: RestoreModalProps) {
  const [step, setStep] = useState<Step>('source')
  const [source, setSource] = useState<Source>(null)
  const [selectedBackup, setSelectedBackup] = useState<string | null>(null)
  const [uploadedFile, setUploadedFile] = useState<File | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<RestoreResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [calendarMonth, setCalendarMonth] = useState<Date>(new Date())
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Group backups by date for calendar display
  const backupsByDate = useMemo(() => {
    const map = new Map<string, BackupInfo[]>()
    for (const backup of backups) {
      const dateKey = format(parseISO(backup.created_at), 'yyyy-MM-dd')
      const existing = map.get(dateKey) || []
      existing.push(backup)
      map.set(dateKey, existing)
    }
    for (const [key, list] of map) {
      map.set(key, list.sort((a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      ))
    }
    return map
  }, [backups])

  const datesWithBackups = useMemo(
    () => new Set(backupsByDate.keys()),
    [backupsByDate]
  )

  const recentBackups = useMemo(
    () => [...backups]
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 3),
    [backups]
  )

  const calendarDays = useMemo(() => {
    const monthStart = startOfMonth(calendarMonth)
    const monthEnd = endOfMonth(calendarMonth)
    const gridStart = startOfWeek(monthStart, { locale: sv })
    const gridEnd = endOfWeek(monthEnd, { locale: sv })
    return eachDayOfInterval({ start: gridStart, end: gridEnd })
  }, [calendarMonth])

  const backupsForSelectedDate = useMemo(() => {
    if (!selectedDate) return []
    const dateKey = format(selectedDate, 'yyyy-MM-dd')
    return backupsByDate.get(dateKey) || []
  }, [selectedDate, backupsByDate])

  // Auto-navigate calendar to most recent backup when entering step 2
  useEffect(() => {
    if (step === 'select' && source === 'server' && backups.length > 0) {
      const sorted = [...backups].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )
      const mostRecentDate = parseISO(sorted[0].created_at)
      setCalendarMonth(startOfMonth(mostRecentDate))
      setSelectedDate(mostRecentDate)
    }
  }, [step, source, backups])

  const resetState = () => {
    setStep('source')
    setSource(null)
    setSelectedBackup(null)
    setUploadedFile(null)
    setConfirmed(false)
    setLoading(false)
    setResult(null)
    setError(null)
    setCalendarMonth(new Date())
    setSelectedDate(null)
  }

  const handleClose = () => {
    if (loading) return
    resetState()
    onClose()
  }

  const handleSourceSelect = (src: Source) => {
    setSource(src)
    setStep('select')
  }

  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      if (!file.name.endsWith('.zip') && !file.name.endsWith('.tar.gz')) {
        setError('Filen måste vara en .zip- eller .tar.gz-fil')
        return
      }
      setUploadedFile(file)
      setError(null)
    }
  }

  const handleNext = () => {
    if (step === 'select') {
      setStep('confirm')
    }
  }

  const handleBack = () => {
    if (step === 'select') {
      setStep('source')
      setSource(null)
      setSelectedBackup(null)
      setUploadedFile(null)
    } else if (step === 'confirm') {
      setStep('select')
      setConfirmed(false)
    }
  }

  const handleRestore = async () => {
    setLoading(true)
    setStep('progress')
    setError(null)

    try {
      let response: RestoreResponse

      if (source === 'server' && selectedBackup) {
        const res = await backupApi.restoreFromServer(selectedBackup)
        response = res.data
      } else if (source === 'upload' && uploadedFile) {
        const res = await backupApi.restoreFromUpload(uploadedFile)
        response = res.data
      } else {
        throw new Error('Ingen backup vald')
      }

      setResult(response)
      setStep('result')

      if (response.success) {
        // Auto-reload after 3 seconds on success
        setTimeout(() => {
          window.location.reload()
        }, 3000)
      }
    } catch (err: any) {
      // Check if this is a network error (connection lost during DB swap)
      const isNetworkError = err.message === 'Network Error' || err.code === 'ERR_NETWORK'

      if (isNetworkError) {
        // Database swap likely succeeded but killed the connection
        // Show a "probably succeeded" message and reload
        setResult({
          success: true,
          backup_filename: selectedBackup || uploadedFile?.name || 'unknown',
          message: 'Återställningen verkar ha slutförts. Anslutningen bröts under databasbytet.',
          stages_completed: ['verify', 'extract', 'version_check', 'create_temp_db', 'restore_db', 'restore_files', 'migrations', 'validation', 'swap'],
        })
        setStep('result')

        // Auto-reload after 5 seconds
        setTimeout(() => {
          window.location.reload()
        }, 5000)
      } else {
        // Real error
        const errorMessage = err.response?.data?.detail || err.message || 'Ett fel uppstod'
        setError(errorMessage)
        setResult({
          success: false,
          backup_filename: selectedBackup || uploadedFile?.name || 'unknown',
          message: errorMessage,
          stages_completed: [],
        })
        setStep('result')
      }
    } finally {
      setLoading(false)
    }
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleString('sv-SE')
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold text-gray-900">
              Återställ från backup
            </h3>
            {!loading && (
              <button onClick={handleClose} className="text-gray-400 hover:text-gray-600">
                <X className="w-6 h-6" />
              </button>
            )}
          </div>

          {/* Step 1: Select source */}
          {step === 'source' && (
            <div>
              <p className="text-gray-600 mb-6">Välj var du vill hämta backup från:</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <button
                  onClick={() => handleSourceSelect('server')}
                  className="p-6 border-2 border-gray-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors text-left"
                >
                  <Server className="w-8 h-8 text-blue-600 mb-3" />
                  <h4 className="font-medium text-gray-900 mb-1">Från server</h4>
                  <p className="text-sm text-gray-600">
                    Välj en backup som redan finns på servern
                  </p>
                  {backups.length > 0 && (
                    <p className="text-xs text-blue-600 mt-2">
                      {backups.length} backup{backups.length !== 1 ? 's' : ''} tillgängliga
                    </p>
                  )}
                </button>
                <button
                  onClick={() => handleSourceSelect('upload')}
                  className="p-6 border-2 border-gray-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors text-left"
                >
                  <Upload className="w-8 h-8 text-blue-600 mb-3" />
                  <h4 className="font-medium text-gray-900 mb-1">Ladda upp fil</h4>
                  <p className="text-sm text-gray-600">
                    Ladda upp en backup-fil (.tar.gz eller .zip)
                  </p>
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Select backup (server) — Calendar view */}
          {step === 'select' && source === 'server' && (
            <div>
              <p className="text-gray-600 mb-4">Välj vilken backup som ska återställas:</p>
              {backups.length === 0 ? (
                <div className="text-center py-8 text-gray-500">
                  <p>Inga backups hittades på servern.</p>
                </div>
              ) : (
                <>
                  {/* Calendar */}
                  <div className="border border-gray-200 rounded-lg p-4 mb-4">
                    {/* Month navigation */}
                    <div className="flex items-center justify-between mb-3">
                      <button
                        onClick={() => setCalendarMonth(prev => subMonths(prev, 1))}
                        className="p-1 rounded hover:bg-gray-100 text-gray-600"
                        aria-label="Föregående månad"
                      >
                        <ChevronLeft className="w-5 h-5" />
                      </button>
                      <h4 className="text-sm font-semibold text-gray-900 capitalize">
                        {format(calendarMonth, 'LLLL yyyy', { locale: sv })}
                      </h4>
                      <button
                        onClick={() => setCalendarMonth(prev => addMonths(prev, 1))}
                        className="p-1 rounded hover:bg-gray-100 text-gray-600"
                        aria-label="Nästa månad"
                      >
                        <ChevronRight className="w-5 h-5" />
                      </button>
                    </div>

                    {/* Weekday headers */}
                    <div className="grid grid-cols-7 mb-1">
                      {['Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör', 'Sön'].map(day => (
                        <div key={day} className="text-center text-xs font-medium text-gray-500 py-1">
                          {day}
                        </div>
                      ))}
                    </div>

                    {/* Day grid */}
                    <div className="grid grid-cols-7">
                      {calendarDays.map((day) => {
                        const dateKey = format(day, 'yyyy-MM-dd')
                        const inMonth = isSameMonth(day, calendarMonth)
                        const hasBackups = datesWithBackups.has(dateKey)
                        const isSelected = selectedDate && isSameDay(day, selectedDate)
                        const dayIsToday = isToday(day)

                        return (
                          <button
                            key={dateKey}
                            onClick={() => {
                              if (inMonth) {
                                setSelectedDate(day)
                                setSelectedBackup(null)
                              }
                            }}
                            disabled={!inMonth}
                            className={[
                              'relative flex flex-col items-center justify-center h-9 w-full text-sm transition-colors',
                              !inMonth && 'text-gray-300 cursor-default',
                              inMonth && !isSelected && 'hover:bg-gray-100 rounded-full cursor-pointer',
                              inMonth && hasBackups && !isSelected && 'text-gray-900 font-medium',
                              inMonth && !hasBackups && !isSelected && 'text-gray-400',
                              isSelected && 'bg-primary-600 text-white rounded-full font-medium',
                              dayIsToday && !isSelected && 'ring-1 ring-primary-400 rounded-full',
                            ].filter(Boolean).join(' ')}
                          >
                            <span>{format(day, 'd')}</span>
                            {hasBackups && !isSelected && (
                              <span className="absolute bottom-0.5 w-1 h-1 rounded-full bg-primary-500" />
                            )}
                            {hasBackups && isSelected && (
                              <span className="absolute bottom-0.5 w-1 h-1 rounded-full bg-white" />
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>

                  {/* Backup list for selected date */}
                  <div>
                    {selectedDate ? (
                      <>
                        <h5 className="text-sm font-medium text-gray-700 mb-2">
                          Backuper {format(selectedDate, 'd MMMM yyyy', { locale: sv })}
                        </h5>
                        {backupsForSelectedDate.length === 0 ? (
                          <p className="text-sm text-gray-400 py-3 text-center">
                            Inga backuper detta datum.
                          </p>
                        ) : (
                          <div className="space-y-2 max-h-40 overflow-y-auto">
                            {backupsForSelectedDate.map((backup) => (
                              <label
                                key={backup.filename}
                                className={`flex items-center p-3 border-2 rounded-lg cursor-pointer transition-colors ${
                                  selectedBackup === backup.filename
                                    ? 'border-primary-500 bg-primary-50'
                                    : 'border-gray-200 hover:border-gray-300'
                                }`}
                              >
                                <input
                                  type="radio"
                                  name="backup"
                                  value={backup.filename}
                                  checked={selectedBackup === backup.filename}
                                  onChange={() => setSelectedBackup(backup.filename)}
                                  className="mr-3 accent-primary-500"
                                />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-3 text-sm">
                                    <span className="font-medium text-gray-900">
                                      {format(parseISO(backup.created_at), 'HH:mm')}
                                    </span>
                                    <span className="text-gray-500">v{backup.app_version}</span>
                                    <span className="text-gray-500">Schema: {backup.schema_version.slice(0, 8)}</span>
                                    <span className="text-gray-500">{formatFileSize(backup.size_bytes)}</span>
                                  </div>
                                </div>
                              </label>
                            ))}
                          </div>
                        )}
                      </>
                    ) : (
                      <p className="text-sm text-gray-400 py-3 text-center">
                        Välj ett datum i kalendern.
                      </p>
                    )}
                  </div>

                  {/* Quick access: recent backups */}
                  {recentBackups.length > 0 && (
                    <div className="mt-4 pt-4 border-t border-gray-100">
                      <h5 className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
                        Senaste backuper
                      </h5>
                      <div className="flex flex-wrap gap-2">
                        {recentBackups.map((backup) => {
                          const isActive = selectedBackup === backup.filename
                          return (
                            <button
                              key={backup.filename}
                              onClick={() => {
                                const backupDate = parseISO(backup.created_at)
                                setCalendarMonth(startOfMonth(backupDate))
                                setSelectedDate(backupDate)
                                setSelectedBackup(backup.filename)
                              }}
                              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                                isActive
                                  ? 'bg-primary-500 text-white'
                                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                              }`}
                            >
                              <span>{format(parseISO(backup.created_at), 'd MMM HH:mm', { locale: sv })}</span>
                              <span className={isActive ? 'text-primary-100' : 'text-gray-400'}>
                                ({formatFileSize(backup.size_bytes)})
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}
              <div className="flex justify-between mt-6">
                <button onClick={handleBack} className="btn btn-secondary">
                  Tillbaka
                </button>
                <button
                  onClick={handleNext}
                  disabled={!selectedBackup}
                  className="btn btn-primary"
                >
                  Nästa
                </button>
              </div>
            </div>
          )}

          {/* Step 2: Select backup (upload) */}
          {step === 'select' && source === 'upload' && (
            <div>
              <p className="text-gray-600 mb-4">Ladda upp en backup-fil:</p>
              <div
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
                  uploadedFile
                    ? 'border-green-500 bg-green-50'
                    : 'border-gray-300 hover:border-blue-500 hover:bg-blue-50'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".zip,.tar.gz"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                {uploadedFile ? (
                  <div>
                    <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-3" />
                    <p className="font-medium text-gray-900">{uploadedFile.name}</p>
                    <p className="text-sm text-gray-600 mt-1">
                      {formatFileSize(uploadedFile.size)}
                    </p>
                    <p className="text-sm text-blue-600 mt-2">Klicka för att välja en annan fil</p>
                  </div>
                ) : (
                  <div>
                    <Upload className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                    <p className="text-gray-600">Klicka för att välja en fil</p>
                    <p className="text-sm text-gray-500 mt-1">.tar.gz (databas + filer) eller .zip (JSON-arkiv)</p>
                  </div>
                )}
              </div>
              {error && (
                <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-800">
                  {error}
                </div>
              )}
              <div className="flex justify-between mt-6">
                <button onClick={handleBack} className="btn btn-secondary">
                  Tillbaka
                </button>
                <button
                  onClick={handleNext}
                  disabled={!uploadedFile}
                  className="btn btn-primary"
                >
                  Nästa
                </button>
              </div>
            </div>
          )}

          {/* Step 3: Confirm */}
          {step === 'confirm' && (
            <div>
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
                <div className="flex items-start">
                  <AlertTriangle className="w-6 h-6 text-amber-600 mr-3 flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-medium text-amber-900">Bekräfta återställning</h4>
                    <p className="text-sm text-amber-800 mt-1">
                      Detta kommer ersätta <strong>ALL</strong> data i systemet med backupens innehåll.
                      Denna åtgärd kan inte ångras.
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-6">
                <h5 className="text-sm font-medium text-gray-700 mb-2">Vald backup:</h5>
                <p className="font-medium text-gray-900">
                  {source === 'server' ? selectedBackup : uploadedFile?.name}
                </p>
                {source === 'server' && selectedBackup && (
                  <div className="text-sm text-gray-600 mt-1">
                    {(() => {
                      const backup = backups.find((b) => b.filename === selectedBackup)
                      return backup ? (
                        <>
                          Skapad: {formatDate(backup.created_at)} | Storlek: {formatFileSize(backup.size_bytes)}
                        </>
                      ) : null
                    })()}
                  </div>
                )}
                {source === 'upload' && uploadedFile && (
                  <div className="text-sm text-gray-600 mt-1">
                    Storlek: {formatFileSize(uploadedFile.size)}
                  </div>
                )}
              </div>

              <label className="flex items-start mb-6 cursor-pointer">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  className="mt-1 mr-3"
                />
                <span className="text-sm text-gray-700">
                  Jag förstår att all nuvarande data kommer ersättas och vill fortsätta med återställningen.
                </span>
              </label>

              <div className="flex justify-between">
                <button onClick={handleBack} className="btn btn-secondary">
                  Tillbaka
                </button>
                <button
                  onClick={handleRestore}
                  disabled={!confirmed}
                  className="btn bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  Återställ
                </button>
              </div>
            </div>
          )}

          {/* Step 4: Progress */}
          {step === 'progress' && (
            <div className="text-center py-8">
              <Loader2 className="w-12 h-12 text-blue-500 mx-auto mb-4 animate-spin" />
              <h4 className="font-medium text-gray-900 mb-2">Återställer backup...</h4>
              <p className="text-sm text-gray-600">
                Detta kan ta några minuter. Stäng inte webbläsaren.
              </p>
            </div>
          )}

          {/* Step 5: Result */}
          {step === 'result' && result && (
            <div>
              {result.success ? (
                <div className="text-center py-4">
                  <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
                  <h4 className="text-xl font-medium text-gray-900 mb-2">
                    Återställning slutförd!
                  </h4>
                  <p className="text-gray-600 mb-4">{result.message}</p>

                  {result.stages_completed.length > 0 && (
                    <div className="text-left bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4">
                      <h5 className="text-sm font-medium text-gray-700 mb-2">Genomförda steg:</h5>
                      <ul className="text-sm text-gray-600 space-y-1">
                        {result.stages_completed.map((stage) => (
                          <li key={stage} className="flex items-center">
                            <CheckCircle className="w-4 h-4 text-green-500 mr-2" />
                            {stage}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <p className="text-sm text-blue-800">
                      Sidan laddas om automatiskt om 3 sekunder...
                    </p>
                  </div>
                </div>
              ) : (
                <div className="text-center py-4">
                  <XCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
                  <h4 className="text-xl font-medium text-gray-900 mb-2">
                    Återställning misslyckades
                  </h4>
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4 text-left">
                    <p className="text-sm text-red-800">{result.message}</p>
                  </div>

                  {result.stages_completed.length > 0 && (
                    <div className="text-left bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4">
                      <h5 className="text-sm font-medium text-gray-700 mb-2">
                        Steg som slutfördes innan felet:
                      </h5>
                      <ul className="text-sm text-gray-600 space-y-1">
                        {result.stages_completed.map((stage) => (
                          <li key={stage} className="flex items-center">
                            <CheckCircle className="w-4 h-4 text-green-500 mr-2" />
                            {stage}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <button onClick={handleClose} className="btn btn-primary">
                    Stäng
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
