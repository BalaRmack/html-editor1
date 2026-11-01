import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/renderer/src/App'
import { api } from '../src/renderer/src/lib/api'
import { useAppStore } from '../src/renderer/src/store/app'

vi.mock('framer-motion', async () => {
  const actual = await vi.importActual<typeof import('framer-motion')>('framer-motion')
  return { ...actual, AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</> }
})

/** Exposed by the mock backend only (browser preview / jsdom). */
type MockControl = {
  breakInstance: (id: string, files?: string[]) => void
  failInstall: (code?: string, file?: string, message?: string) => void
  repair: (id: string) => void
}
const mockControl = () => (window as unknown as { __verdantMock: MockControl }).__verdantMock

const playButton = (): HTMLButtonElement => {
  const buttons = screen.getAllByRole('button')
  const button = buttons.find((item) => item.className.includes('play-button'))
  if (!button) throw new Error('play button not found')
  return button as HTMLButtonElement
}

function resetStore(): void {
  useAppStore.setState({
    screen: 'play',
    game: { state: 'idle', instanceId: null, startedAt: null, exitCode: null, crashReportLocation: null },
    createOpen: false,
    toasts: [],
    integrity: {},
    task: null,
    crash: null
  })
}

beforeEach(() => {
  api.game.kill()
  resetStore()
})

afterEach(() => {
  // The mock keeps its "broken files" map between tests — always clean up.
  mockControl().repair('a1')
})

describe('download failures are surfaced, not swallowed', () => {
  it('locks «Играть» while the integrity check says files are missing', async () => {
    mockControl().breakInstance('a1', ['client-1.21.4.jar', 'lwjgl-3.3.3.jar'])

    render(<App />)
    // The banner badge switches to the error state and the CTA is disabled…
    await waitFor(() => expect(screen.getAllByText('Ошибка загрузки').length).toBeGreaterThan(0), { timeout: 5000 })
    const button = playButton()
    expect(button.disabled).toBe(true)
    expect(button.className).toContain('play-button--error')
    expect(button.textContent).toContain('Ошибка загрузки')

    // …while the panel explains which files are broken and offers a retry.
    expect(screen.getByText('Файлы игры не скачаны')).toBeTruthy()
    expect(screen.getByText(/Проблемных файлов: 2/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Повторить загрузку/ })).toBeTruthy()
  })

  it('shows a red toast with the file name and a retry button when a download dies', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => expect(playButton().disabled).toBe(false), { timeout: 8000 })

    mockControl().failInstall('network_error', 'client-1.21.4.jar')
    // Same entry point the play button uses.
    await useAppStore.getState().installInstance('a1')

    // The forced failure comes from install.run → store → toast
    await waitFor(() => expect(screen.getByText('Загрузка не удалась')).toBeTruthy(), { timeout: 12000 })
    // Shown both in the toast and in the play-screen error panel.
    expect(screen.getAllByText(/Не удалось скачать файл «client-1\.21\.4\.jar»/).length).toBeGreaterThan(0)
    const toast = screen.getByText('Загрузка не удалась').closest('div.pointer-events-auto') as HTMLElement
    expect(within(toast).getByRole('button', { name: /Повторить/ })).toBeTruthy()

    // The play button is now locked with the error label
    await waitFor(() => expect(playButton().disabled).toBe(true))
    expect(playButton().textContent).toContain('Ошибка загрузки')

    // Retry from the toast recovers the instance
    await user.click(within(toast).getByRole('button', { name: /Повторить/ }))
    await waitFor(() => expect(playButton().disabled).toBe(false), { timeout: 20000 })
    expect(playButton().textContent).toContain('ИГРАТЬ')
  })

  it('stores the structured failure so the modal can show the same reason', async () => {
    render(<App />)
    await waitFor(() => expect(playButton().disabled).toBe(false), { timeout: 8000 })

    mockControl().failInstall('network_error', 'assets-1.21.4.json')
    await useAppStore.getState().installInstance('a1')

    const state = useAppStore.getState().integrity.a1
    expect(state.status).toBe('error')
    if (state.status === 'error') {
      expect(state.code).toBe('network_error')
      expect(state.file).toBe('assets-1.21.4.json')
    }
    expect(useAppStore.getState().toasts.at(-1)?.action?.labelKey).toBe('common.retry')
  })

  it('never enables «Играть» on a cancelled install', async () => {
    render(<App />)
    await waitFor(() => expect(playButton().disabled).toBe(false), { timeout: 8000 })

    const run = vi.spyOn(api.install, 'run').mockResolvedValueOnce({ ok: false, code: 'cancelled' })
    await useAppStore.getState().installInstance('a1')
    // Cancelling resets to "unverified" and the screen immediately re-checks it.
    expect(['unknown', 'checking']).toContain(useAppStore.getState().integrity.a1.status)
    // Cancelling is not an error: no red toast, but the button stays unverified.
    expect(useAppStore.getState().toasts.some((toast) => toast.kind === 'error')).toBe(false)
    run.mockRestore()
  })
})
