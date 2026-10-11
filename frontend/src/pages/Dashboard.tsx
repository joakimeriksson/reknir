import { useEffect, useState } from 'react'
import { TrendingUp, TrendingDown, Wallet, AlertCircle, Clock, FileText } from 'lucide-react'
import api from '../services/api'
import { useCompany } from '../contexts/CompanyContext'
import { useFiscalYear } from '../contexts/FiscalYearContext'
import StatCard from '../components/StatCard'
import RevenueExpenseChart from '../components/RevenueExpenseChart'
import MonthVerificationsModal from '../components/MonthVerificationsModal'
import FiscalYearSelector from '../components/FiscalYearSelector'
import { useToast } from '@/contexts/ToastContext'
import GapsPanel from '@/components/compliance/GapsPanel'
import DeadlinesCard from '@/components/compliance/DeadlinesCard'
import type { VerificationGap, Deadline } from '@/types'

interface MonthVerification {
  id: number
  verification_number: number
  series: string
  transaction_date: string
  description: string
  amount: number
  type: 'revenue' | 'expense'
}

interface DashboardData {
  verification_gaps?: VerificationGap[]
  locked_through?: string | null
  deadlines?: Deadline[]
  fiscal_year: {
    id: number
    label: string
    start_date: string
    end_date: string
    is_closed: boolean
  }
  current_month: {
    revenue: number
    expenses: number
    profit: number
    month_label: string
  }
  liquidity: number
  overdue_invoices: {
    count: number
    amount: number
  }
  pending_expenses: {
    count: number
    amount: number
  }
  recent_verifications: Array<{
    id: number
    verification_number: number
    series: string
    transaction_date: string
    description: string
    locked: boolean
  }>
  monthly_trend: Array<{
    month: string
    revenue: number
    expenses: number
    profit: number
  }>
}

export default function Dashboard() {
  const { selectedCompany } = useCompany()
  const { showToast } = useToast()
  const { selectedFiscalYear, loadFiscalYears } = useFiscalYear()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null)
  const [monthVerifications, setMonthVerifications] = useState<MonthVerification[]>([])
  const [loadingVerifications, setLoadingVerifications] = useState(false)

  // Load fiscal years when company changes
  useEffect(() => {
    if (selectedCompany) {
      loadFiscalYears(selectedCompany.id)
    }
  }, [selectedCompany])

  // Load dashboard data when company or fiscal year changes
  useEffect(() => {
    if (selectedCompany && selectedFiscalYear) {
      loadDashboardData()
    }
  }, [selectedCompany, selectedFiscalYear])

  const loadDashboardData = async () => {
    if (!selectedCompany || !selectedFiscalYear) return

    try {
      setLoading(true)
      const params = new URLSearchParams({
        company_id: selectedCompany.id.toString(),
        fiscal_year_id: selectedFiscalYear.id.toString()
      })
      const response = await api.get(`/dashboard/overview?${params}`)
      setData(response.data)
    } catch (error) {
      console.error('Failed to load dashboard data:', error)
    } finally {
      setLoading(false)
    }
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('sv-SE', {
      style: 'currency',
      currency: 'SEK',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value)
  }

  const handleMonthClick = async (month: string) => {
    if (!selectedCompany || !selectedFiscalYear) return

    try {
      setLoadingVerifications(true)
      setSelectedMonth(month)
      const params = new URLSearchParams({
        company_id: selectedCompany.id.toString(),
        fiscal_year_id: selectedFiscalYear.id.toString(),
        month: month
      })
      const response = await api.get(`/dashboard/month-verifications?${params}`)
      setMonthVerifications(response.data)
    } catch (error) {
      console.error('Failed to load month verifications:', error)
      showToast('Kunde inte ladda verifikationer för denna månad', 'error')
      setSelectedMonth(null)
    } finally {
      setLoadingVerifications(false)
    }
  }

  const handleCloseModal = () => {
    setSelectedMonth(null)
    setMonthVerifications([])
  }

  if (!selectedCompany) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-3" />
          <p className="text-gray-500">Välj ett företag för att se översikten</p>
        </div>
      </div>
    )
  }

  if (!selectedFiscalYear) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-gray-400 mx-auto mb-3" />
          <p className="text-gray-500">Välj ett räkenskapsår för att se översikten</p>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-3"></div>
          <p className="text-gray-500">Laddar översikt...</p>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-gray-500">Kunde inte ladda data</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Översikt</h1>
          <div className="flex items-center gap-3 mt-1">
            <p className="text-gray-500">{selectedCompany.name}</p>
            {data?.fiscal_year && (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800">
                Räkenskapsår: {data.fiscal_year.label}
                {data.fiscal_year.is_closed && (
                  <span className="ml-2 text-xs">(Avslutat)</span>
                )}
              </span>
            )}
          </div>
        </div>
        <FiscalYearSelector />
      </div>

      {/* Current Month KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <StatCard
          title="Intäkter denna månad"
          value={formatCurrency(data.current_month.revenue)}
          subtitle={data.current_month.month_label}
          icon={TrendingUp}
          color="green"
        />

        <StatCard
          title="Kostnader denna månad"
          value={formatCurrency(data.current_month.expenses)}
          subtitle={data.current_month.month_label}
          icon={TrendingDown}
          color="red"
        />

        <StatCard
          title="Resultat denna månad"
          value={formatCurrency(data.current_month.profit)}
          subtitle={data.current_month.month_label}
          icon={TrendingUp}
          color={data.current_month.profit >= 0 ? 'green' : 'red'}
        />

        <StatCard
          title="Likviditet"
          value={formatCurrency(data.liquidity)}
          subtitle="Bankkonto (1930)"
          icon={Wallet}
          color={data.liquidity >= 0 ? 'blue' : 'red'}
        />
      </div>

      {/* Compliance */}
      {selectedCompany && data.verification_gaps && data.verification_gaps.length > 0 && (
        <GapsPanel
          companyId={selectedCompany.id}
          fiscalYearId={data.fiscal_year.id}
          gaps={data.verification_gaps}
          onChange={() => loadDashboardData()}
        />
      )}
      {data.deadlines && <DeadlinesCard deadlines={data.deadlines} />}
      {data.locked_through && (
        <p className="text-sm text-gray-500">Bokföringen är låst t.o.m. {data.locked_through}.</p>
      )}

      {/* Alerts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Overdue Invoices */}
        {data.overdue_invoices.count > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-semibold text-red-900">Förfallna fakturor</h3>
                <p className="text-sm text-red-800 mt-1">
                  Du har <strong>{data.overdue_invoices.count}</strong> förfallen{data.overdue_invoices.count !== 1 ? 'a' : ''} faktura{data.overdue_invoices.count !== 1 ? 'or' : ''}
                  {' '}på totalt <strong>{formatCurrency(data.overdue_invoices.amount)}</strong>
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Pending Expenses */}
        {data.pending_expenses.count > 0 && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <Clock className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="font-semibold text-yellow-900">Väntande utlägg</h3>
                <p className="text-sm text-yellow-800 mt-1">
                  Du har <strong>{data.pending_expenses.count}</strong> utlägg som väntar på godkännande/betalning
                  {' '}på totalt <strong>{formatCurrency(data.pending_expenses.amount)}</strong>
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Revenue & Expense Chart */}
      <RevenueExpenseChart data={data.monthly_trend} onMonthClick={handleMonthClick} />

      {/* Recent Verifications */}
      <div className="bg-white rounded-lg shadow">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">Senaste verifikationer</h2>
        </div>
        <div className="overflow-x-auto">
          {data.recent_verifications.length === 0 ? (
            <div className="p-6 text-center text-gray-500">
              <FileText className="w-12 h-12 text-gray-400 mx-auto mb-3" />
              <p>Inga verifikationer ännu</p>
            </div>
          ) : (
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Nummer
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Datum
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Beskrivning
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {data.recent_verifications.map((verification) => (
                  <tr key={verification.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      {verification.series}{verification.verification_number}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(verification.transaction_date).toLocaleDateString('sv-SE')}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      {verification.description}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm">
                      {verification.locked ? (
                        <span className="px-2 py-1 bg-gray-100 text-gray-800 rounded text-xs font-medium">
                          Låst
                        </span>
                      ) : (
                        <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded text-xs font-medium">
                          Öppen
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Month Verifications Modal */}
      {selectedMonth && !loadingVerifications && (
        <MonthVerificationsModal
          month={selectedMonth}
          verifications={monthVerifications}
          onClose={handleCloseModal}
        />
      )}
    </div>
  )
}
