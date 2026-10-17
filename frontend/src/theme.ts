import { useEffect, useState } from 'react'

// Light or dark. "system" follows the device's setting, and is the default. The choice is per browser,
// kept in localStorage: it's only a preference, so a browser that won't store it just follows the system.
export type ThemeChoice = 'system' | 'light' | 'dark'

const KEY = 'lucid-theme'
const darkQuery = () => window.matchMedia?.('(prefers-color-scheme: dark)')

export function storedTheme(): ThemeChoice {
  try {
    const value = localStorage.getItem(KEY)
    return value === 'light' || value === 'dark' ? value : 'system'
  } catch {
    return 'system'
  }
}

function store(choice: ThemeChoice) {
  try {
    if (choice === 'system') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, choice)
  } catch {
    // Not stored: the choice holds until the page is closed.
  }
}

// Puts the theme on <html data-theme>, where index.css turns the palette around for dark.
export function applyTheme(choice: ThemeChoice) {
  const dark = choice === 'dark' || (choice === 'system' && !!darkQuery()?.matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
}

// The theme choice, applied, and kept in step with the device while it's "system".
export function useTheme(): [ThemeChoice, (choice: ThemeChoice) => void] {
  const [choice, setChoice] = useState(storedTheme)
  useEffect(() => {
    applyTheme(choice)
    if (choice !== 'system') return
    const query = darkQuery()
    const follow = () => applyTheme('system')
    query?.addEventListener('change', follow)
    return () => query?.removeEventListener('change', follow)
  }, [choice])
  return [
    choice,
    (next) => {
      store(next)
      setChoice(next)
    },
  ]
}
