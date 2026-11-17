import ProfilePanel from '@/components/ProfilePanel'
import LayoutPreferences from '@/components/settings/LayoutPreferences'

export default function AccountPage() {
  return (
    <div>
      <h1 className="text-3xl font-bold mb-6">Mitt konto</h1>
      <div className="mb-6">
        <ProfilePanel />
      </div>
      <LayoutPreferences />
    </div>
  )
}
