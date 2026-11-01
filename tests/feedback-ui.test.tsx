import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/renderer/src/App'
import { useAppStore } from '../src/renderer/src/store/app'

vi.mock('framer-motion', async () => {
  const actual = await vi.importActual<typeof import('framer-motion')>('framer-motion')
  return {
    ...actual,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>
  }
})

beforeAll(() => {
  class ObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ObserverStub
  ;(globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = ObserverStub
  Element.prototype.scrollIntoView = vi.fn()
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    })
  })
})

beforeEach(() => {
  useAppStore.setState({
    screen: 'play',
    toasts: [],
    task: null,
    crash: null,
    profileModalOpen: false,
    createOpen: false,
    feedbackKind: null,
    settingsTab: 'general'
  })
})

async function boot(): Promise<void> {
  render(<App />)
  await waitFor(() => expect(screen.getByText('ИГРАТЬ')).toBeTruthy(), { timeout: 8000 })
}

describe('feedback buttons and modals', () => {
  it('keeps two icon buttons with tooltips at the bottom of the sidebar', async () => {
    await boot()
    const nav = screen.getAllByRole('navigation')[0]
    const bug = within(nav).getByRole('button', { name: 'Сообщить об ошибке' })
    const idea = within(nav).getByRole('button', { name: 'Предложить улучшение' })
    expect(bug).toBeTruthy()
    expect(idea).toBeTruthy()
    // icons only — no emoji glyphs inside the buttons
    expect(bug.textContent ?? '').toBe('')
    expect(idea.textContent ?? '').toBe('')
    // …and they sit after every navigation entry
    const buttons = within(nav).getAllByRole('button')
    expect(buttons.slice(-2)).toEqual([bug, idea])
  })

  it('opens the bug report with system info and the last 100 log lines attached', async () => {
    const user = userEvent.setup()
    await boot()
    const nav = screen.getAllByRole('navigation')[0]
    await user.click(within(nav).getByRole('button', { name: 'Сообщить об ошибке' }))

    const dialog = await screen.findByRole('dialog', {}, { timeout: 6000 })
    expect(within(dialog).getByText('Системная информация')).toBeTruthy()
    await waitFor(() => expect(within(dialog).getByText(/строк$/)).toBeTruthy(), { timeout: 6000 })
    // the log attachment is present for bug reports
    expect(within(dialog).getByText('latest.log')).toBeTruthy()
    // and «Отправить» stays disabled until the description is long enough
    const send = within(dialog).getByRole('button', { name: /Отправить/ }) as HTMLButtonElement
    expect(send.disabled).toBe(true)

    const textarea = within(dialog).getByRole('textbox')
    await user.type(textarea, 'Установка упала на ассетах, индекс 34 повреждён')
    await waitFor(() => expect((within(dialog).getByRole('button', { name: /Отправить/ }) as HTMLButtonElement).disabled).toBe(false))
    await user.click(within(dialog).getByRole('button', { name: /Отправить/ }))
    await waitFor(() => expect(within(dialog).getByText('Отправлено!')).toBeTruthy(), { timeout: 6000 })
  })

  it('asks for an optional contact in the suggestion form only', async () => {
    const user = userEvent.setup()
    await boot()
    const nav = screen.getAllByRole('navigation')[0]
    await user.click(within(nav).getByRole('button', { name: 'Предложить улучшение' }))

    const dialog = await screen.findByRole('dialog', {}, { timeout: 6000 })
    expect(within(dialog).getByText('Контакт (необязательно)')).toBeTruthy()
    // suggestions do not attach the log file
    expect(within(dialog).queryByText('latest.log')).toBeNull()
  })
})
