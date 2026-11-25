import type { Team } from './data/deals'

// Which team's pages the app shows (docs/adr/0012). It starts as your own team; switching is kept per
// browser in localStorage, like the theme, and a browser that won't store it starts from your team again.
const KEY = 'lucid-workspace'

export function storedWorkspace(): Team | null {
  try {
    const value = localStorage.getItem(KEY)
    return value === 'business' || value === 'growth' ? value : null
  } catch {
    return null
  }
}

export function storeWorkspace(team: Team) {
  try {
    localStorage.setItem(KEY, team)
  } catch {
    // Not stored: the switch holds until the page is closed.
  }
}
