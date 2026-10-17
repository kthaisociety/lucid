import type { Person } from '../data/deals'
import { initialsOf } from '../format'

const colors = [
  'bg-violet-100 text-violet-700',
  'bg-sky-100 text-sky-700',
  'bg-amber-100 text-amber-700',
  'bg-rose-100 text-rose-700',
  'bg-teal-100 text-teal-700',
  'bg-emerald-100 text-emerald-700',
]

// The same person always gets the same color.
function colorFor(person: Person): string {
  let hash = 0
  for (const ch of person.email || person.name) hash = (hash * 31 + ch.charCodeAt(0)) | 0
  return colors[Math.abs(hash) % colors.length]
}

export default function OwnerAvatar({ owner }: { owner: Person }) {
  return (
    <span
      title={owner.name}
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ring-2 ring-surface ${colorFor(owner)}`}
    >
      {initialsOf(owner.name)}
    </span>
  )
}
