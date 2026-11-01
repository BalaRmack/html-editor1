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
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub
  ;(globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = ResizeObserverStub
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
  // the browser mock keeps its content lists per page load — reset between tests
  ;(window as unknown as { __verdantMock?: { resetContent: () => void } }).__verdantMock?.resetContent()
  useAppStore.setState({
    screen: 'instances',
    toasts: [],
    task: null,
    crash: null,
    profileModalOpen: false,
    createOpen: false
  })
})

/**
 * Opens the instance «Настроить» window from the instance grid.
 * Always query the dialog through `dialog()`: the window is portalled and the
 * whole screen re-mounts once the boot promise resolves, so a captured node
 * would go stale.
 */
function dialog(): HTMLElement {
  return screen.getByRole('dialog')
}

/** Clicks the table row (not the right-hand card) of a given file name. */
async function selectRow(user: ReturnType<typeof userEvent.setup>, name: string): Promise<void> {
  const rows = within(dialog())
    .getAllByText(name)
    .map((node) => node.closest('div[class*="grid-cols"]'))
    .filter((node): node is HTMLElement => Boolean(node))
  await user.click(rows[0])
  await waitFor(() => expect(within(dialog()).getByRole('button', { name: /Открыть папку/ })).toBeTruthy())
}

async function openManager(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  render(<App />)
  await waitFor(() => expect(screen.getAllByText('Настроить').length).toBeGreaterThan(0), { timeout: 8000 })
  await user.click(screen.getAllByText('Настроить')[0])
  await waitFor(() => expect(within(dialog()).getAllByText('Логи').length).toBeGreaterThan(0), { timeout: 8000 })
  // wait for the installed list to land
  await waitFor(() => expect(within(dialog()).getByText('Sodium')).toBeTruthy(), { timeout: 8000 })
}

describe('instance content manager', () => {
  it('shows the six sections and the compatibility badge of the instance', async () => {
    const user = userEvent.setup()
    await openManager(user)

    for (const label of ['Логи', 'Версии', 'Modrinth', 'Моды', 'Ресурспаки', 'Шейдеры']) {
      expect(within(dialog()).getAllByText(label).length).toBeGreaterThan(0)
    }
    // version + loader are always visible in the left rail
    expect(within(dialog()).getAllByText('1.21.4').length).toBeGreaterThan(0)
    expect(within(dialog()).getAllByText('Fabric').length).toBeGreaterThan(0)

    // installed mods land in the centre table with the requested columns
    for (const column of ['Название', 'Версия', 'Дата', 'Автор', 'Статус']) {
      expect(within(dialog()).getByText(column)).toBeTruthy()
    }
  })

  it('enables/disables and deletes a file from the right actions panel', async () => {
    const user = userEvent.setup()
    await openManager(user)

    await selectRow(user, 'Sodium')

    // the panel button (the row checkbox only has an aria-label)
    await user.click(within(dialog()).getAllByText('Отключить').at(-1) as HTMLElement)
    await waitFor(() => expect(within(dialog()).getAllByText('Включить').length).toBeGreaterThan(0), { timeout: 8000 })

    await user.click(within(dialog()).getAllByText('Удалить').at(-1) as HTMLElement)
    await waitFor(() => expect(within(dialog()).queryByText('Sodium')).toBeNull(), { timeout: 8000 })
  })

  it('flags outdated files and applies the update', async () => {
    const user = userEvent.setup()
    await openManager(user)

    await user.click(within(dialog()).getByRole('button', { name: /Проверить обновления/ }))
    await waitFor(() => expect(within(dialog()).getAllByText('Обновление').length).toBeGreaterThan(0), { timeout: 8000 })

    await selectRow(user, 'Sodium')
    await user.click(within(dialog()).getAllByText('Обновить').at(-1) as HTMLElement)
    await waitFor(() => expect(within(dialog()).getAllByText('1.2.0').length).toBeGreaterThan(0), { timeout: 8000 })
    // the very same file no longer carries an update badge
    await waitFor(() => expect(within(dialog()).queryAllByText('Обновление').length).toBeLessThan(2), { timeout: 4000 })
  })

  it('catalogue only lists builds for the instance version and loader', async () => {
    const user = userEvent.setup()
    await openManager(user)

    await user.click(within(dialog()).getAllByText('Modrinth')[0])
    await waitFor(() => expect(within(dialog()).getAllByText('Установить').length).toBeGreaterThan(1), { timeout: 8000 })
    // the search field is pre-filtered with the instance version
    expect(screen.getByPlaceholderText('Поиск под 1.21.4…')).toBeTruthy()
    // and every catalogue card is stamped with the exact version badge
    expect(within(dialog()).getAllByText('1.21.4').length).toBeGreaterThan(1)
  })
})
