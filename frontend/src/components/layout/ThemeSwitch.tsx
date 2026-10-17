import { Monitor, Moon, Sun } from 'lucide-react'
import type { ThemeChoice } from '../../theme'

const choices = [
  { id: 'system', label: 'System', icon: Monitor },
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon },
] as const satisfies { id: ThemeChoice; label: string; icon: unknown }[]

// Light, dark, or as the device is set.
export default function ThemeSwitch({ theme, onChange }: { theme: ThemeChoice; onChange: (theme: ThemeChoice) => void }) {
  return (
    <div role="group" aria-label="Theme" className="inline-flex rounded-md border border-gray-200 p-0.5">
      {choices.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          aria-label={`${label} theme`}
          title={`${label} theme`}
          aria-pressed={theme === id}
          onClick={() => onChange(id)}
          className={`rounded p-1 ${theme === id ? 'bg-gray-100 text-gray-900' : 'text-gray-500 hover:text-gray-900'}`}
        >
          <Icon size={13} aria-hidden />
        </button>
      ))}
    </div>
  )
}
