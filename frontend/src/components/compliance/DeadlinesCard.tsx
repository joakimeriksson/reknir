import { CalendarClock } from 'lucide-react'
import type { Deadline } from '@/types'

const KIND_LABEL: Record<Deadline['kind'], string> = {
  vat: 'Moms',
  ink2: 'Skatt',
  annual_report: 'Bolagsverket',
  annual_meeting: 'Stämma',
}

function tone(d: Deadline): string {
  if (d.status === 'locked') return 'text-green-700 bg-green-50 border-green-200'
  if (d.status === 'past') return 'text-red-700 bg-red-50 border-red-200'
  if (d.days_left <= 14) return 'text-amber-800 bg-amber-50 border-amber-200'
  return 'text-gray-700 bg-gray-50 border-gray-200'
}

function label(d: Deadline): string {
  if (d.status === 'locked') return 'period låst'
  if (d.status === 'past') return `${-d.days_left} dagar sen`
  if (d.days_left === 0) return 'idag'
  return `om ${d.days_left} dagar`
}

export default function DeadlinesCard({ deadlines }: { deadlines: Deadline[] }) {
  if (deadlines.length === 0) return null
  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-3">
        <CalendarClock className="w-5 h-5 text-gray-600" />
        <h3 className="font-semibold">Kommande deadlines</h3>
      </div>
      <ul className="space-y-2">
        {deadlines.map((d) => (
          <li key={`${d.kind}-${d.due}-${d.title}`} className={`flex items-center justify-between gap-3 px-3 py-2 rounded-md border text-sm ${tone(d)}`}>
            <span>
              <span className="inline-block w-20 text-xs uppercase tracking-wide opacity-70">{KIND_LABEL[d.kind]}</span>
              {d.title}
            </span>
            <span className="whitespace-nowrap font-mono">
              {d.due} <span className="opacity-70">({label(d)})</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-gray-500">
        Beräknade från momsperiod och räkenskapsår enligt Skatteverkets och Bolagsverkets regler. Lås perioden när deklarationen är inlämnad.
      </p>
    </div>
  )
}
