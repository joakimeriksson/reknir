import { useState } from 'react'
import { Building2, Plus, Save, Upload, X } from 'lucide-react'
import { backupApi, companyApi } from '@/services/api'
import { useCompany } from '@/contexts/CompanyContext'
import { useToast } from '@/contexts/ToastContext'
import CompanyFormFields, { emptyCompanyForm, formatCompanyError } from './CompanyFormFields'

export default function CompanyAdmin() {
  const { companies, selectedCompany, setSelectedCompany, loadCompanies } = useCompany()
  const { showToast } = useToast()
  const [showCreateCompany, setShowCreateCompany] = useState(false)
  const [companyForm, setCompanyForm] = useState(emptyCompanyForm())
  const [creatingCompany, setCreatingCompany] = useState(false)
  const [importingCompany, setImportingCompany] = useState(false)

  const handleCreateCompany = async () => {
    try {
      setCreatingCompany(true)
      const response = await companyApi.create(companyForm)
      showToast('Nytt företag skapat!', 'success')
      setShowCreateCompany(false)
      setCompanyForm(emptyCompanyForm())
      await loadCompanies()
      setSelectedCompany(response.data)
    } catch (error: any) {
      console.error('Failed to create company:', error)
      showToast(formatCompanyError(error), 'error')
    } finally {
      setCreatingCompany(false)
    }
  }

  const cancelCreateCompany = () => {
    setShowCreateCompany(false)
    setCompanyForm(emptyCompanyForm())
  }

  const handleImportCompany = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.name.endsWith('.zip')) {
      showToast('Filen måste vara ett .zip-arkiv', 'error')
      return
    }
    try {
      setImportingCompany(true)
      const response = await backupApi.importCompany(file)
      const warnings = response.data.warnings || []
      showToast(
        warnings.length > 0
          ? `Företag importerat med ${warnings.length} varning(ar) – se konsolen`
          : 'Företag importerat som nytt företag',
        warnings.length > 0 ? 'error' : 'success',
      )
      if (warnings.length > 0) console.warn('Company import warnings:', warnings)
      await loadCompanies()
    } catch (error: any) {
      console.error('Company import failed:', error)
      showToast(error.response?.data?.detail || 'Import misslyckades', 'error')
    } finally {
      setImportingCompany(false)
    }
  }

  return (
    <div>
      <div className="card mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <Building2 className="w-5 h-5" />
            Företag ({companies.length})
          </h2>
          {!showCreateCompany && (
            <button onClick={() => setShowCreateCompany(true)} className="btn btn-primary flex items-center gap-2">
              <Plus className="w-4 h-4" />
              Nytt företag
            </button>
          )}
        </div>

        {showCreateCompany ? (
          <div className="space-y-6">
            <CompanyFormFields form={companyForm} onChange={setCompanyForm} />

            <div className="flex gap-2 pt-4 border-t">
              <button
                onClick={handleCreateCompany}
                disabled={creatingCompany || !companyForm.name || !companyForm.org_number}
                className="btn btn-primary flex items-center gap-2"
              >
                <Save className="w-4 h-4" />
                Skapa företag
              </button>
              <button
                onClick={cancelCreateCompany}
                disabled={creatingCompany}
                className="btn btn-secondary flex items-center gap-2"
              >
                <X className="w-4 h-4" />
                Avbryt
              </button>
            </div>
          </div>
        ) : companies.length === 0 ? (
          <p className="text-gray-500">Inga företag ännu.</p>
        ) : (
          <div className="space-y-2">
            {companies.map((company) => (
              <div
                key={company.id}
                className={`flex items-center justify-between p-3 rounded-lg border ${
                  selectedCompany?.id === company.id
                    ? 'border-primary-500 bg-primary-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div>
                  <p className="font-medium text-gray-900">{company.name}</p>
                  <p className="text-sm text-gray-600">Org.nr: {company.org_number}</p>
                </div>
                {selectedCompany?.id === company.id ? (
                  <span className="text-sm font-medium text-primary-700">Valt</span>
                ) : (
                  <button
                    onClick={() => setSelectedCompany(company)}
                    className="text-sm text-primary-600 hover:text-primary-700 font-medium"
                  >
                    Välj
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card mb-6">
        <h2 className="text-xl font-semibold mb-4">Importera företagsarkiv</h2>
        <p className="text-gray-600 mb-4">
          Importera ett företagsarkiv (.zip) som ett nytt företag. Befintliga företag påverkas inte. Ett arkiv
          exporteras under Företagsinställningar → Import/Export.
        </p>
        <label
          className={`btn btn-secondary inline-flex items-center cursor-pointer ${importingCompany ? 'opacity-50 pointer-events-none' : ''}`}
        >
          <Upload className="w-4 h-4 mr-2" />
          {importingCompany ? 'Importerar...' : 'Importera företagsarkiv'}
          <input type="file" accept=".zip" onChange={handleImportCompany} className="hidden" disabled={importingCompany} />
        </label>
      </div>
    </div>
  )
}
