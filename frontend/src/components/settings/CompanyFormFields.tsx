import { AccountingBasis, VATReportingPeriod } from '@/types'

export interface CompanyFormData {
  name: string
  org_number: string
  address: string
  postal_code: string
  city: string
  phone: string
  email: string
  fiscal_year_start: string
  fiscal_year_end: string
  vat_number: string
  accounting_basis: AccountingBasis
  vat_reporting_period: VATReportingPeriod
  is_vat_registered: boolean
}

export const emptyCompanyForm = (): CompanyFormData => ({
  name: '',
  org_number: '',
  address: '',
  postal_code: '',
  city: '',
  phone: '',
  email: '',
  fiscal_year_start: new Date().getFullYear() + '-01-01',
  fiscal_year_end: new Date().getFullYear() + '-12-31',
  vat_number: '',
  accounting_basis: AccountingBasis.ACCRUAL,
  vat_reporting_period: VATReportingPeriod.QUARTERLY,
  is_vat_registered: true,
})

export function formatCompanyError(error: any): string {
  if (error.response?.data?.detail) {
    const detail = error.response.data.detail
    // If detail is an array of validation errors
    if (Array.isArray(detail)) {
      return detail.map((err: any) => {
        const field = err.loc?.slice(-1)[0] || 'okänt fält'
        const message = err.msg || err.type || 'valideringsfel'
        return `• ${field}: ${message}`
      }).join('\n')
    }
    // If detail is a string
    if (typeof detail === 'string') {
      return detail
    }
    // If detail is an object, try to stringify it
    return JSON.stringify(detail, null, 2)
  }
  return `Ett fel uppstod: ${error.message || 'Okänt fel'}`
}

interface Props {
  form: CompanyFormData
  onChange: (form: CompanyFormData) => void
}

export default function CompanyFormFields({ form: companyForm, onChange: setCompanyForm }: Props) {
  return (
    <>
      {/* Grunduppgifter */}
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">Grunduppgifter</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Företagsnamn *
            </label>
            <input
              type="text"
              value={companyForm.name}
              onChange={(e) => setCompanyForm({ ...companyForm, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Organisationsnummer *
            </label>
            <input
              type="text"
              value={companyForm.org_number}
              onChange={(e) => setCompanyForm({ ...companyForm, org_number: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
              placeholder="123456-7890 eller 1234567890"
              pattern="^\d{6}-?\d{4}$"
              required
            />
            <p className="mt-1 text-xs text-gray-500">
              10 siffror, med eller utan bindestreck (t.ex. 123456-7890)
            </p>
          </div>
        </div>
      </div>

      {/* Kontaktuppgifter */}
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">Kontaktuppgifter</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">Adress</label>
            <input
              type="text"
              value={companyForm.address}
              onChange={(e) => setCompanyForm({ ...companyForm, address: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
              placeholder="Gatunamn 123"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Postnummer</label>
            <input
              type="text"
              value={companyForm.postal_code}
              onChange={(e) => setCompanyForm({ ...companyForm, postal_code: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
              placeholder="123 45"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Stad</label>
            <input
              type="text"
              value={companyForm.city}
              onChange={(e) => setCompanyForm({ ...companyForm, city: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
              placeholder="Stockholm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Telefon</label>
            <input
              type="tel"
              value={companyForm.phone}
              onChange={(e) => setCompanyForm({ ...companyForm, phone: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
              placeholder="08-123 456 78"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">E-post</label>
            <input
              type="email"
              value={companyForm.email}
              onChange={(e) => setCompanyForm({ ...companyForm, email: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
              placeholder="info@företag.se"
            />
          </div>
        </div>
      </div>

      {/* Bokföringsinställningar */}
      <div>
        <h3 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wide">Bokföringsinställningar</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Räkenskapsår start *
            </label>
            <input
              type="date"
              value={companyForm.fiscal_year_start}
              onChange={(e) => setCompanyForm({ ...companyForm, fiscal_year_start: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Räkenskapsår slut *
            </label>
            <input
              type="date"
              value={companyForm.fiscal_year_end}
              onChange={(e) => setCompanyForm({ ...companyForm, fiscal_year_end: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Bokföringsmetod
            </label>
            <select
              value={companyForm.accounting_basis}
              onChange={(e) => setCompanyForm({ ...companyForm, accounting_basis: e.target.value as AccountingBasis })}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            >
              <option value="accrual">Bokföringsmässiga grunder</option>
              <option value="cash">Kontantmetoden</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={companyForm.is_vat_registered}
                onChange={(e) => setCompanyForm({ ...companyForm, is_vat_registered: e.target.checked })}
                className="w-4 h-4 text-primary-600 border-gray-300 rounded focus:ring-primary-500"
              />
              <span className="text-sm font-medium text-gray-700">
                Företaget är momsregistrerat
              </span>
            </label>
            <p className="mt-1 text-xs text-gray-500 ml-6">
              Avmarkera om företaget inte är registrerat för moms hos Skatteverket
            </p>
          </div>
          <div>
            <label className={`block text-sm font-medium mb-1 ${companyForm.is_vat_registered ? 'text-gray-700' : 'text-gray-400'}`}>
              Momsredovisningsperiod
            </label>
            <select
              value={companyForm.vat_reporting_period}
              onChange={(e) => setCompanyForm({ ...companyForm, vat_reporting_period: e.target.value as VATReportingPeriod })}
              disabled={!companyForm.is_vat_registered}
              className={`w-full px-3 py-2 border border-gray-300 rounded-md ${
                !companyForm.is_vat_registered ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : ''
              }`}
            >
              <option value="monthly">Månadsvis</option>
              <option value="quarterly">Kvartalsvis</option>
              <option value="yearly">Årlig</option>
            </select>
            {!companyForm.is_vat_registered && (
              <p className="mt-1 text-xs text-gray-400">
                Ej relevant för företag som inte är momsregistrerade
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
