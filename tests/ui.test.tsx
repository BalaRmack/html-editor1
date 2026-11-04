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
  // jsdom does not implement these, framer-motion / scroll containers rely on them
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
  // the zustand store is a module singleton: reset navigation between tests
  useAppStore.setState({
    screen: 'play',
    toasts: [],
    task: null,
    crash: null,
    profileModalOpen: false,
    createOpen: false
  })
})

describe('renderer smoke test (mock backend)', () => {
  it('boots into the play screen with the selected instance', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByText('ИГРАТЬ')).toBeTruthy(), { timeout: 5000 })
    expect(screen.getAllByText(/Выживание 1.21.4/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Steve/).length).toBeGreaterThan(0)
  })

  it('navigates between all screens without crashing', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => expect(screen.getByText('ИГРАТЬ')).toBeTruthy(), { timeout: 5000 })

    const nav = screen.getAllByRole('navigation')[0]
    const buttons = within(nav).getAllByRole('button')

    // play, instances, mods, skins, console, settings
    await user.click(buttons[1])
    await waitFor(() => expect(screen.getByPlaceholderText('Поиск по названию…')).toBeTruthy(), { timeout: 4000 })

    await user.click(buttons[2])
    await waitFor(() => expect(screen.getByText('Каталог')).toBeTruthy(), { timeout: 4000 })

    await user.click(buttons[3])
    await waitFor(() => expect(screen.getByText(/Перетащите PNG/)).toBeTruthy(), { timeout: 4000 })

    await user.click(buttons[4])
    await waitFor(() => expect(screen.getByText('Друзья и игра по сети')).toBeTruthy(), { timeout: 4000 })

    await user.click(buttons[5])
    await waitFor(() => expect(screen.getByText('Автоскролл')).toBeTruthy(), { timeout: 4000 })

    await user.click(buttons[6])
    await waitFor(() => expect(screen.getByText('Язык интерфейса')).toBeTruthy(), { timeout: 4000 })

    // memory tab exposes the slider
    await user.click(screen.getByRole('button', { name: 'Память' }))
    await waitFor(() => expect(screen.getByText('Максимум памяти')).toBeTruthy())
  })

  it('opens the profile modal and updates the nickname', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => expect(screen.getByText('ИГРАТЬ')).toBeTruthy(), { timeout: 5000 })

    const profileButton = screen.getAllByRole('button').find((button) => button.textContent?.includes('Steve'))
    expect(profileButton).toBeTruthy()
    await user.click(profileButton!)

    await waitFor(() => expect(screen.getByText(/UUID генерируется локально/)).toBeTruthy())
    const input = screen.getByDisplayValue('Steve') as HTMLInputElement
    await user.clear(input)
    await user.type(input, 'Notch')
    await user.click(screen.getAllByRole('button').find((button) => button.textContent?.trim() === 'Сохранить')!)

    await waitFor(() => expect(screen.getAllByText(/Notch/).length).toBeGreaterThan(0), { timeout: 4000 })
  })

  it('shows the mod catalog with mocked results', async () => {
    const user = userEvent.setup()
    render(<App />)
    await waitFor(() => expect(screen.getByText('ИГРАТЬ')).toBeTruthy(), { timeout: 5000 })
    const nav = screen.getAllByRole('navigation')[0]
    await user.click(within(nav).getAllByRole('button')[2])
    await waitFor(() => expect(screen.getByText('Sodium')).toBeTruthy(), { timeout: 5000 })
    expect(screen.getByText('Iris Shaders')).toBeTruthy()
  })
})
