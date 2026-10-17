// The tiles and bar lists of the Reports page and My page.
import type { Bar } from '../../data/views'
import { statusColors } from '../statusColors'

export function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-surface p-4">
      <p className="text-[11px] font-medium text-gray-500">{label}</p>
      <p className="font-display mt-1 text-xl font-bold text-gray-900">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-gray-400">{hint}</p>}
    </div>
  )
}

// One series of horizontal bars. The title names the series, so there is no legend; every bar carries its
// value as text, so nothing depends on color alone.
export function BarList({ title, bars, format = String }: { title: string; bars: Bar[]; format?: (n: number) => string }) {
  const max = Math.max(1, ...bars.map((b) => b.value))
  return (
    <section aria-label={title} className="rounded-xl border border-gray-200 bg-surface p-4">
      <h3 className="text-xs font-semibold text-gray-700">{title}</h3>
      <ul className="mt-3 space-y-2">
        {bars.map((bar) => (
          <li key={bar.label} title={`${bar.label}: ${format(bar.value)}`} className="grid grid-cols-[7rem_1fr_auto] items-center gap-3">
            <span className="truncate text-xs text-gray-600">{bar.label}</span>
            <span className="h-2.5">
              {bar.value > 0 && (
                <span
                  className={`block h-full rounded-r ${bar.status ? statusColors[bar.status] : 'bg-indigo-500'}`}
                  style={{ width: `${Math.max(2, (bar.value / max) * 100)}%` }}
                />
              )}
            </span>
            <span className="text-right text-xs font-semibold text-gray-900 tabular-nums">{format(bar.value)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
