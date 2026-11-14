import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import SettingsTabs from '@/components/settings/SettingsTabs'
import CompanyAdmin from '@/components/settings/CompanyAdmin'
import BackupSettings from '@/components/settings/BackupSettings'
import AISettingsPanel from '@/components/settings/AISettingsPanel'

type SystemTab = 'companies' | 'backup' | 'ai'

const SYSTEM_TABS: { id: SystemTab; label: string }[] = [
  { id: 'companies', label: 'Företag' },
  { id: 'backup', label: 'Backup' },
  { id: 'ai', label: 'AI-assistent' },
]

export default function SystemSettingsPage() {
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState<SystemTab>('companies')

  if (!user?.is_admin) {
    return <Navigate to="/" replace />
  }

  return (
    <div>
      <h1 className="text-3xl font-bold mb-6">Systeminställningar</h1>
      <SettingsTabs tabs={SYSTEM_TABS} active={activeTab} onChange={setActiveTab} />

      {activeTab === 'companies' && <CompanyAdmin />}
      {activeTab === 'backup' && <BackupSettings />}
      {activeTab === 'ai' && <AISettingsPanel />}
    </div>
  )
}
