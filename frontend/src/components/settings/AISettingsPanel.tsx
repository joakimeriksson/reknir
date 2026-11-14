import { useEffect, useState } from 'react'
import { aiApi } from '@/services/api'
import type { AISettings, OllamaModel, OllamaHealth } from '@/types'
import { Bot, Loader2, Save } from 'lucide-react'
import { useToast } from '@/contexts/ToastContext'

export default function AISettingsPanel() {
  const { showToast } = useToast()
  const [, setAiSettings] = useState<AISettings | null>(null)
  const [aiModels, setAiModels] = useState<OllamaModel[]>([])
  const [aiHealth, setAiHealth] = useState<OllamaHealth | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [aiSaving, setAiSaving] = useState(false)
  const [aiTesting, setAiTesting] = useState(false)
  const [aiForm, setAiForm] = useState({ ai_enabled: false, ollama_url: '', ollama_model: '', system_prompt: '' })

  useEffect(() => {
    loadAiSettings()
  }, [])

  const loadAiSettings = async () => {
    setAiLoading(true)
    try {
      const settingsResp = await aiApi.getSettings()
      setAiSettings(settingsResp.data)
      setAiForm({
        ai_enabled: settingsResp.data.ai_enabled,
        ollama_url: settingsResp.data.ollama_url,
        ollama_model: settingsResp.data.ollama_model,
        system_prompt: settingsResp.data.system_prompt || '',
      })
      // Only load models list (no health test)
      try {
        const modelsResp = await aiApi.listModels()
        setAiModels(modelsResp.data)
      } catch {
        setAiModels([])
      }
    } catch {
      // AI may not be configured yet
    } finally {
      setAiLoading(false)
    }
  }

  const testAiConnection = async () => {
    setAiTesting(true)
    setAiHealth(null)
    try {
      // Save current form first so the test uses the right URL/model
      await aiApi.updateSettings({
        ollama_url: aiForm.ollama_url,
        ollama_model: aiForm.ollama_model,
      })
      const healthResp = await aiApi.getHealth()
      setAiHealth(healthResp.data)
      // Refresh models list
      try {
        const modelsResp = await aiApi.listModels()
        setAiModels(modelsResp.data)
      } catch {
        // ignore
      }
    } catch {
      setAiHealth({ reachable: false, model_available: null, model_name: null, error: 'Kunde inte nå backend' })
    } finally {
      setAiTesting(false)
    }
  }

  const saveAiSettings = async () => {
    setAiSaving(true)
    try {
      const resp = await aiApi.updateSettings({
        ai_enabled: aiForm.ai_enabled,
        ollama_url: aiForm.ollama_url,
        ollama_model: aiForm.ollama_model,
        system_prompt: aiForm.system_prompt || null,
      })
      setAiSettings(resp.data)
      showToast('AI-inställningar sparade', 'success')
    } catch {
      showToast('Kunde inte spara AI-inställningar', 'error')
    } finally {
      setAiSaving(false)
    }
  }

  return (
    <div>
      {aiLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : (
        <>
          {/* Toggle card */}
          <div className={`rounded-xl border-2 p-5 mb-6 ${
            aiForm.ai_enabled
              ? 'border-primary-200 bg-primary-50/50'
              : 'border-gray-200 bg-gray-50'
          }`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                  aiForm.ai_enabled ? 'bg-primary-100' : 'bg-gray-200'
                }`}>
                  <Bot className={`w-5 h-5 ${aiForm.ai_enabled ? 'text-primary-600' : 'text-gray-500'}`} />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-gray-900">
                    AI-assistent {aiForm.ai_enabled ? 'aktiverad' : 'inaktiverad'}
                  </h2>
                  <p className="text-sm text-gray-500">
                    {aiForm.ai_enabled
                      ? 'Chattassistenten är synlig för alla användare i företaget'
                      : 'Slå på för att göra chattassistenten tillgänglig'}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setAiForm({ ...aiForm, ai_enabled: !aiForm.ai_enabled })}
                className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors flex-shrink-0 ${
                  aiForm.ai_enabled ? 'bg-primary-600' : 'bg-gray-300'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                    aiForm.ai_enabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>

          {/* Connection settings */}
          <div className="card mb-6">
            <h3 className="text-sm font-semibold text-gray-700 mb-4 uppercase tracking-wide">Anslutning</h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Ollama-adress</label>
                <input
                  type="text"
                  value={aiForm.ollama_url}
                  onChange={(e) => setAiForm({ ...aiForm, ollama_url: e.target.value })}
                  className="input w-full"
                  placeholder="http://host.docker.internal:11434"
                />
                <p className="text-xs text-gray-400 mt-1">
                  URL:en till Ollama-servern som kör AI-modellen
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Modell</label>
                {aiModels.length > 0 ? (
                  <select
                    value={aiForm.ollama_model}
                    onChange={(e) => setAiForm({ ...aiForm, ollama_model: e.target.value })}
                    className="input w-full"
                  >
                    <option value="">Välj modell...</option>
                    {aiModels.map((model) => (
                      <option key={model.name} value={model.name}>
                        {model.name}
                        {model.parameter_size ? ` — ${model.parameter_size}` : ''}
                        {model.quantization_level ? ` (${model.quantization_level})` : ''}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={aiForm.ollama_model}
                    onChange={(e) => setAiForm({ ...aiForm, ollama_model: e.target.value })}
                    className="input w-full"
                    placeholder="llama3.1:8b"
                  />
                )}
                <p className="text-xs text-gray-400 mt-1">
                  {aiModels.length > 0
                    ? 'Välj bland installerade modeller'
                    : 'Ange modellnamn eller testa anslutningen för att se tillgängliga modeller'}
                </p>
              </div>
            </div>

            {/* Test connection button + result */}
            <div className="flex items-center gap-3 pt-3 border-t border-gray-100">
              <button
                onClick={testAiConnection}
                disabled={aiTesting || !aiForm.ollama_url}
                className="btn btn-outline-primary flex items-center gap-2 text-sm"
              >
                {aiTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Testa anslutning
              </button>
              {aiHealth && !aiTesting && (
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    aiHealth.reachable
                      ? aiHealth.model_available ? 'bg-green-500' : 'bg-yellow-500'
                      : 'bg-red-500'
                  }`} />
                  <span className="text-sm text-gray-600">
                    {aiHealth.reachable
                      ? aiHealth.model_available
                        ? `Redo — ${aiHealth.model_name} svarar`
                        : `Ollama ansluten men modellen svarar inte${aiHealth.error ? ` (${aiHealth.error})` : ''}`
                      : `Kan inte nå Ollama${aiHealth.error ? ` — ${aiHealth.error}` : ''}`
                    }
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Behavior settings */}
          <div className="card mb-6">
            <h3 className="text-sm font-semibold text-gray-700 mb-4 uppercase tracking-wide">Beteende</h3>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Extra instruktioner</label>
              <textarea
                value={aiForm.system_prompt}
                onChange={(e) => setAiForm({ ...aiForm, system_prompt: e.target.value })}
                className="input w-full min-h-[140px]"
                rows={6}
                placeholder={'Exempel:\n- Använd alltid konto 6212 för mobiltelefoni\n- Vår standard-momssats är 25%\n- Föreslå aldrig konto 2990'}
              />
              <p className="text-xs text-gray-400 mt-1">
                Egna regler som komplettar de inbyggda bokföringsinstruktionerna. Lämna tomt för standardbeteende.
              </p>
            </div>
          </div>

          {/* Save */}
          <div className="flex justify-end">
            <button
              onClick={saveAiSettings}
              disabled={aiSaving}
              className="btn btn-primary flex items-center gap-2"
            >
              {aiSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Spara inställningar
            </button>
          </div>
        </>
      )}
    </div>
  )
}
