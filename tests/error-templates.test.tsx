import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/renderer/src/App'
import { localizeError, translate } from '../src/renderer/src/i18n'
import { api } from '../src/renderer/src/lib/api'
import { useAppStore } from '../src/renderer/src/store/app'

vi.mock('framer-motion', async () => {
  const actual = await vi.importActual<typeof import('framer-motion')>('framer-motion')
  return { ...actual, AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</> }
})

const t = (key: Parameters<typeof translate>[1], vars?: Record<string, string | number>): string =>
  translate('ru', key, vars)

const mockControl = () =>
  (window as unknown as { __verdantMock: { failInstall: (code?: string, file?: string, message?: string) => void; repair: (id: string) => void } })
    .__verdantMock

const playButton = (): HTMLButtonElement =>
  screen.getAllByRole('button').find((item) => item.className.includes('play-button')) as HTMLButtonElement

describe('error sentences never leak raw `{placeholders}`', () => {
  it('uses the file name when it is known', () => {
    expect(localizeError(t, 'network_error', { file: 'client.jar' })).toBe('Ошибка сети. Не удалось скачать файл «client.jar»')
  })

  it('falls back to the generic sentence when the file name is missing', () => {
    const sentence = localizeError(t, 'network_error')
    expect(sentence).not.toContain('{')
    expect(sentence).toBe('Ошибка сети. Не удалось скачать файлы игры')
  })

  it('never renders braces for an unknown code either', () => {
    expect(localizeError(t, 'some_new_code')).toBe('Неизвестная ошибка')
  })
})

describe('a network failure without a file name is still readable in the toast', () => {
  beforeEach(() => {
    api.game.kill()
    useAppStore.setState({
      screen: 'play',
      game: { state: 'idle', instanceId: null, startedAt: null, exitCode: null, crashReportLocation: null },
      createOpen: false,
      toasts: [],
      integrity: {},
      task: null,
      crash: null
    })
  })

  it('shows the generic sentence, never the template', async () => {
    render(<App />)
    await waitFor(() => expect(playButton().disabled).toBe(false), { timeout: 8000 })

    mockControl().failInstall('network_error', '', 'Сеть недоступна')
    await useAppStore.getState().installInstance('a1')

    await waitFor(() => expect(screen.getByText('Загрузка не удалась')).toBeTruthy(), { timeout: 12000 })
    expect(screen.queryByText(/\{file\}/)).toBeNull()
    expect(screen.getAllByText(/Ошибка сети/).length).toBeGreaterThan(0)
    mockControl().repair('a1')
  })
})
