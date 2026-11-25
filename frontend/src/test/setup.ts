import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'

// Preferences kept in localStorage (theme, workspace) mustn't carry from one test to the next.
afterEach(() => localStorage.clear())
