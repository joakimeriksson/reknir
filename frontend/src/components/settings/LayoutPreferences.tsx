import { Layout } from 'lucide-react'
import { useLayoutSettings } from '@/contexts/LayoutSettingsContext'

export default function LayoutPreferences() {
  const { settings: layoutSettings, updateSettings: updateLayoutSettings } = useLayoutSettings()

  return (
    <div className="card mb-6">
      <div className="flex items-center gap-2 mb-4">
        <Layout className="w-5 h-5 text-gray-600" />
        <h2 className="text-xl font-semibold">Utseende</h2>
      </div>

      {/* Split View Settings */}
      <div className="mb-6">
        <h3 className="text-lg font-medium text-gray-900 mb-2">Delad vy</h3>
        <p className="text-gray-600 mb-4">
          Välj på vilken sida bilagor ska visas när du använder delad vy i verifikationer och fakturor.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-xl">
          <label className={`flex flex-col p-4 border-2 rounded-lg cursor-pointer transition-colors ${
            layoutSettings.splitViewAttachmentSide === 'left'
              ? 'border-blue-500 bg-blue-50'
              : 'border-gray-200 hover:border-gray-300'
          }`}>
            <div className="flex items-start">
              <input
                type="radio"
                name="splitViewAttachmentSide"
                value="left"
                checked={layoutSettings.splitViewAttachmentSide === 'left'}
                onChange={() => updateLayoutSettings({ splitViewAttachmentSide: 'left' })}
                className="mt-1 mr-3"
              />
              <div className="flex-1">
                <div className="font-medium text-gray-900">Bilagor till vänster</div>
                <div className="text-sm text-gray-600 mt-1">
                  Bilagan visas på vänster sida, formuläret på höger
                </div>
              </div>
            </div>
            {/* Visual diagram */}
            <div className="mt-3 flex gap-1 h-12 rounded overflow-hidden border border-gray-300">
              <div className={`flex-1 flex items-center justify-center text-xs font-medium ${
                layoutSettings.splitViewAttachmentSide === 'left' ? 'bg-blue-200 text-blue-800' : 'bg-gray-200 text-gray-600'
              }`}>
                Bilaga
              </div>
              <div className={`flex-1 flex items-center justify-center text-xs font-medium ${
                layoutSettings.splitViewAttachmentSide === 'left' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
              }`}>
                Formulär
              </div>
            </div>
          </label>

          <label className={`flex flex-col p-4 border-2 rounded-lg cursor-pointer transition-colors ${
            layoutSettings.splitViewAttachmentSide === 'right'
              ? 'border-blue-500 bg-blue-50'
              : 'border-gray-200 hover:border-gray-300'
          }`}>
            <div className="flex items-start">
              <input
                type="radio"
                name="splitViewAttachmentSide"
                value="right"
                checked={layoutSettings.splitViewAttachmentSide === 'right'}
                onChange={() => updateLayoutSettings({ splitViewAttachmentSide: 'right' })}
                className="mt-1 mr-3"
              />
              <div className="flex-1">
                <div className="font-medium text-gray-900">Bilagor till höger</div>
                <div className="text-sm text-gray-600 mt-1">
                  Bilagan visas på höger sida, formuläret på vänster
                </div>
              </div>
            </div>
            {/* Visual diagram */}
            <div className="mt-3 flex gap-1 h-12 rounded overflow-hidden border border-gray-300">
              <div className={`flex-1 flex items-center justify-center text-xs font-medium ${
                layoutSettings.splitViewAttachmentSide === 'right' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
              }`}>
                Formulär
              </div>
              <div className={`flex-1 flex items-center justify-center text-xs font-medium ${
                layoutSettings.splitViewAttachmentSide === 'right' ? 'bg-blue-200 text-blue-800' : 'bg-gray-200 text-gray-600'
              }`}>
                Bilaga
              </div>
            </div>
          </label>
        </div>
      </div>

      <div className="bg-blue-50 border border-blue-200 rounded p-3">
        <p className="text-sm text-blue-800">
          <strong>Tips:</strong> Aktivera delad vy genom att klicka på pin-ikonen i verifikations- eller fakturaformuläret
          när du har en bilaga vald.
        </p>
      </div>
    </div>
  )
}
