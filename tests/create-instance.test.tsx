import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/renderer/src/App'
import { useAppStore } from '../src/renderer/src/store/app'
import { api } from '../src/renderer/src/lib/api'

vi.mock('framer-motion', async () => {
  const actual = await vi.importActual<typeof import('framer-motion')>('framer-motion')
  return {
    ...actual,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>
  }
})

function resetStore(): void {
  useAppStore.setState({
    screen: 'play',
    game: { state: 'idle', instanceId: null, startedAt: null, exitCode: null, crashReportLocation: null },
    createOpen: false,
    createTab: 'versions',
    toasts: [],
    task: null,
    crash: null,
    profileModalOpen: false
  })
}

async function openModal(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  render(<App />)
  await waitFor(() => expect(screen.getByText('ИГРАТЬ')).toBeTruthy(), { timeout: 5000 })
  const nav = screen.getAllByRole('navigation')[0]
  await user.click(within(nav).getAllByRole('button')[1])
  await waitFor(() => expect(screen.getByPlaceholderText('Поиск по названию…')).toBeTruthy())
  await user.click(screen.getByRole('button', { name: /Создать сборку/ }))
  const dialog = await screen.findByRole('dialog')
  // wait until the loader catalogue finished loading (submit enables)
  await waitFor(
    () => {
      const submit = within(dialog).getByRole('button', { name: /^Создать/ }) as HTMLButtonElement
      expect(submit.disabled).toBe(false)
    },
    { timeout: 5000 }
  )
  return dialog
}

beforeEach(() => {
  api.game.kill()
  resetStore()
})

describe('create instance modal', () => {
  it('opens from the instances page with the two tabs', async () => {
    const user = userEvent.setup()
    const dialog = await openModal(user)

    expect(within(dialog).getByText('Новая сборка')).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: /Версии/ })).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: /Модпаки/ })).toBeTruthy()
    // loader radio cards
    expect(within(dialog).getByRole('radiogroup')).toBeTruthy()
    expect(within(dialog).getByRole('radio', { name: /^Fabric/ })).toBeTruthy()
    expect(within(dialog).getByRole('radio', { name: /^NeoForge/ })).toBeTruthy()
  })

  it('lists Mojang versions, filters snapshots and searches', async () => {
    const user = userEvent.setup()
    const dialog = await openModal(user)

    // releases by default -> latest release visible, snapshot hidden
    await waitFor(() => expect(within(dialog).getByText('1.21.4')).toBeTruthy(), { timeout: 4000 })
    expect(within(dialog).queryByText('25w46a')).toBeNull()

    await user.click(within(dialog).getByRole('button', { name: /^Снапшоты$/ }))
    await waitFor(() => expect(within(dialog).getByText('25w46a')).toBeTruthy())

    await user.click(within(dialog).getByRole('button', { name: /^Все$/ }))
    await waitFor(() => expect(within(dialog).getByText('1.21.4')).toBeTruthy())

    const search = within(dialog).getByPlaceholderText('Найти версию…')
    await user.type(search, '1.20')
    await waitFor(() => expect(within(dialog).queryByText('1.21.4')).toBeNull())
    expect(within(dialog).getByText('1.20.1')).toBeTruthy()
  })

  it('switches loader cards and loads matching loader versions', async () => {
    const user = userEvent.setup()
    const dialog = await openModal(user)

    await waitFor(() => expect(within(dialog).getByText('1.21.4')).toBeTruthy())
    await user.click(within(dialog).getByRole('radio', { name: /^Forge/ }))

    await waitFor(() => expect(within(dialog).getByText('Версия загрузчика')).toBeTruthy())
    await waitFor(() => {
      expect(within(dialog).getByRole('combobox')).toBeTruthy()
    })
    // The loader version picker is the custom Select: open it and read the options from the portal.
    await user.click(within(dialog).getByRole('combobox'))
    await waitFor(() => {
      const labels = within(document.body)
        .getAllByRole('option')
        .map((option) => option.textContent ?? '')
      expect(labels.some((label) => label.includes('52.0.7'))).toBe(true)
    })
    await user.keyboard('{Escape}')

    // vanilla hides the loader version picker
    await user.click(within(dialog).getByRole('radio', { name: /^Vanilla/ }))
    await waitFor(() => expect(within(dialog).queryByText('Версия загрузчика')).toBeNull())
  })

  it('creates an instance and walks through progress to the done state', async () => {
    const user = userEvent.setup()
    const dialog = await openModal(user)

    await waitFor(() => expect(within(dialog).getByText('1.21.4')).toBeTruthy())

    const nameInput = within(dialog).getByPlaceholderText(/Например/) as HTMLInputElement
    await user.clear(nameInput)
    await user.type(nameInput, 'Тестовая сборка')

    await user.click(within(dialog).getByRole('button', { name: /^Создать/ }))

    // progress screen
    await waitFor(() => expect(within(dialog).getByText(/Собираем/)).toBeTruthy(), { timeout: 5000 })
    expect(within(dialog).getByText('Файлы игры')).toBeTruthy()
    expect(within(dialog).getByText('Отменить установку')).toBeTruthy()

    // done screen
    await waitFor(() => expect(within(dialog).getByText('Сборка готова')).toBeTruthy(), { timeout: 12000 })
    expect(within(dialog).getByText('Тестовая сборка')).toBeTruthy()
    expect(useAppStore.getState().instances.some((instance) => instance.name === 'Тестовая сборка')).toBe(true)

    await user.click(within(dialog).getByRole('button', { name: /^Играть$/ }))
    await waitFor(() => expect(useAppStore.getState().createOpen).toBe(false))
  })

  it('searches modpacks, shows versions and installs a pack as an instance', async () => {
    const user = userEvent.setup()
    const dialog = await openModal(user)

    await user.click(within(dialog).getByRole('button', { name: /Модпаки/ }))
    await waitFor(() => expect(within(dialog).getByText('Fabulously Optimized')).toBeTruthy(), { timeout: 4000 })

    await user.click(within(dialog).getByText('Fabulously Optimized'))
    await waitFor(() => expect(within(dialog).getByText('Версии модпака')).toBeTruthy())
    await waitFor(() => expect(within(dialog).getByText(/Fabulously Optimized .*r2/)).toBeTruthy())

    await user.click(within(dialog).getByRole('button', { name: /Установить как сборку/ }))
    await waitFor(() => expect(within(dialog).getByText('Сборка готова')).toBeTruthy(), { timeout: 12000 })
    expect(useAppStore.getState().instances.some((instance) => instance.name === 'Fabulously Optimized')).toBe(true)
  })

  it('keeps the created instance when the install fails and retries in place', async () => {
    const user = userEvent.setup()
    const dialog = await openModal(user)
    await waitFor(() => expect(within(dialog).getByText('1.21.4')).toBeTruthy())

    const before = useAppStore.getState().instances.length
    const run = vi.spyOn(api.install, 'run').mockResolvedValueOnce({ ok: false, error: 'network_error' } as never)

    await user.click(within(dialog).getByRole('button', { name: /^Создать/ }))
    // bounced back to the form, with the retry wording and no duplicate instance
    await waitFor(() => expect(within(dialog).getByRole('button', { name: /Продолжить установку/ })).toBeTruthy(), {
      timeout: 6000
    })
    expect(useAppStore.getState().instances.length).toBe(before + 1)

    await user.click(within(dialog).getByRole('button', { name: /Продолжить установку/ }))
    await waitFor(() => expect(within(dialog).getByText('Сборка готова')).toBeTruthy(), { timeout: 12000 })
    expect(useAppStore.getState().instances.length).toBe(before + 1)
    expect(run).toHaveBeenCalledTimes(2)
    run.mockRestore()
  })

  it('never opens the modal when the click is cancelled via the footer', async () => {
    const user = userEvent.setup()
    const dialog = await openModal(user)
    await user.click(within(dialog).getByRole('button', { name: 'Отмена' }))
    await waitFor(() => expect(useAppStore.getState().createOpen).toBe(false))
  })

  it('requests modpack versions through the dedicated API (not the mod loader filter)', async () => {
    const spy = vi.spyOn(api.mods, 'packVersions')
    const user = userEvent.setup()
    const dialog = await openModal(user)
    await user.click(within(dialog).getByRole('button', { name: /Модпаки/ }))
    await waitFor(() => expect(within(dialog).getByText('Better MC [FABRIC]')).toBeTruthy(), { timeout: 4000 })
    await user.click(within(dialog).getByText('Better MC [FABRIC]'))
    await waitFor(() => expect(spy).toHaveBeenCalledWith('modrinth', 'better-mc'))
    spy.mockRestore()
  })
})
