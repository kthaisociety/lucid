export function formatSEK(value: number): string {
  return `${value.toLocaleString('en-US')} SEK`
}

// Accepts a date (YYYY-MM-DD, read as local) or a full timestamp.
export function formatDate(iso: string): string {
  const date = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso)
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function formatDateRange(start: string | null, end: string | null): string {
  if (!start) return ''
  return end && end !== start ? `${formatDate(start)} – ${formatDate(end)}` : formatDate(start)
}

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('')
}

export function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// A rate as a whole percentage, or a dash when there is none yet.
export const percent = (rate: number | null) => (rate === null ? '—' : `${Math.round(rate * 100)}%`)
