import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import App from './App'
import { stubApi } from './test/fakeApi'
import { applyTheme, storedTheme } from './theme'

// A device whose dark-mode setting the test flips.
function stubDevice(dark: boolean) {
  const listeners = new Set<() => void>()
  const query = {
    get matches() {
      return dark
    },
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  }
  vi.stubGlobal('matchMedia', () => query)
  return {
    set: (next: boolean) => {
      dark = next
      act(() => listeners.forEach((fn) => fn()))
    },
    listening: () => listeners.size,
  }
}

const html = () => document.documentElement
const renderApp = () =>
  render(
    <MemoryRouter>
      <App />
    </MemoryRouter>,
  )
// The sidebar's switch (the phone tabs have one too).
const button = (name: string) => screen.getAllByRole('button', { name })[0]

beforeEach(() => {
  stubApi()
  localStorage.clear()
  delete html().dataset.theme
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

test('the theme follows the device until you pick one, and your pick is remembered', async () => {
  const device = stubDevice(true)
  applyTheme(storedTheme())
  expect(html().dataset.theme).toBe('dark')

  renderApp()
  expect(button('System theme')).toHaveAttribute('aria-pressed', 'true')
  device.set(false)
  expect(html().dataset.theme).toBe('light')

  fireEvent.click(button('Dark theme'))
  expect(html().dataset.theme).toBe('dark')
  expect(button('Dark theme')).toHaveAttribute('aria-pressed', 'true')
  expect(device.listening()).toBe(0) // a picked theme no longer follows the device
  device.set(false)
  expect(html().dataset.theme).toBe('dark')

  cleanup()
  delete html().dataset.theme
  applyTheme(storedTheme())
  expect(html().dataset.theme).toBe('dark') // the next visit starts dark

  renderApp()
  fireEvent.click(button('System theme'))
  expect(html().dataset.theme).toBe('light')
  expect(localStorage.getItem('lucid-theme')).toBeNull()
})

test('without storage the theme still switches, for this visit', async () => {
  stubDevice(false)
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('storage is off')
  })
  renderApp()

  fireEvent.click(button('Dark theme'))
  expect(html().dataset.theme).toBe('dark')
  vi.restoreAllMocks()
})
