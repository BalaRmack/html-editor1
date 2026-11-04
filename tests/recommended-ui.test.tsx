import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '../src/renderer/src/App'
import { useAppStore } from '../src/renderer/src/store/app'
import { api } from '../src/renderer/src/lib/api'
import type { RecommendedMod, RecommendedPlan } from '../src/shared/types'

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
    // A build created by an earlier test stays "not installed" in the mock (install.run is stubbed),
    // so always start from the demo build.
    selectedId: 'a1',
    createOpen: false,
    createTab: 'versions',
    toasts: [],
    task: null,
    crash: null,
    profileModalOpen: false
  })
}

async function openForm(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  render(<App />)
  await waitFor(() => expect(screen.getByText('ИГРАТЬ')).toBeTruthy(), { timeout: 5000 })
  const nav = screen.getAllByRole('navigation')[0]
  await user.click(within(nav).getAllByRole('button')[1])
  await waitFor(() => expect(screen.getByPlaceholderText('Поиск по названию…')).toBeTruthy())
  await user.click(screen.getByRole('button', { name: /Создать сборку/ }))
  const dialog = await screen.findByRole('dialog')
  await waitFor(
    () => {
      const submit = within(dialog).getByRole('button', { name: /^Создать/ }) as HTMLButtonElement
      expect(submit.disabled).toBe(false)
    },
    { timeout: 5000 }
  )
  await waitFor(() => expect(within(dialog).getByText('1.21.4')).toBeTruthy())
  return dialog
}

function fakeMod(slug: string, name: string, groupId: 'performance' | 'interface'): RecommendedMod {
  return {
    projectId: `id-${slug}`,
    slug,
    name,
    summary: `${name} summary`,
    iconUrl: null,
    groupId,
    versionId: `v-${slug}`,
    versionNumber: '1.0.0',
    fileName: `${slug}.jar`,
    requires: null
  }
}

const PLAN: RecommendedPlan = {
  mcVersion: '1.21.4',
  loader: 'fabric',
  unavailable: false,
  groups: [
    { id: 'performance', mods: [fakeMod('sodium', 'Sodium', 'performance'), fakeMod('lithium', 'Lithium', 'performance')] },
    { id: 'interface', mods: [fakeMod('modmenu', 'Mod Menu', 'interface')] }
  ]
}

const TITLE = 'Добавить рекомендуемые моды?'
// The mock install takes ~14 s, so the default 12 s / 20 s limits are too tight here.
const DONE_TIMEOUT = 30000
vi.setConfig({ testTimeout: 45000 })

beforeEach(() => {
  api.game.kill()
  resetStore()
  // These tests are about the recommended-mods window, not about install timing:
  // the game install itself finishes at once, so a loaded machine cannot make them flaky.
  vi.spyOn(api.install, 'run').mockResolvedValue({ ok: true } as never)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('recommended mods window', () => {
  it('asks after "Создать", has both groups checked by default and installs the selection', async () => {
    const plan = vi.spyOn(api.mods, 'recommended').mockResolvedValue(PLAN)
    const install = vi.spyOn(api.mods, 'installRecommended').mockResolvedValue({
      installed: ['Sodium', 'Lithium', 'Mod Menu'],
      dependencies: ['Fabric API'],
      failed: []
    })
    const user = userEvent.setup()
    const dialog = await openForm(user)
    await user.click(within(dialog).getByRole('button', { name: /^Создать/ }))

    await screen.findByText(TITLE)
    expect(plan).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Производительность')).toBeTruthy()
    expect(screen.getByText('Интерфейс и удобство')).toBeTruthy()
    expect(screen.getByText('Sodium')).toBeTruthy()
    expect(screen.getByText('Mod Menu')).toBeTruthy()
    // nothing is installed before the user decides
    expect(install).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: /^Установить · 3/ }))
    await waitFor(() => expect(install).toHaveBeenCalledTimes(1), { timeout: 12000 })
    const input = install.mock.calls[0][0]
    expect(input.instanceId).toEqual(expect.any(String))
    expect([...input.projectIds].sort()).toEqual(['id-lithium', 'id-modmenu', 'id-sodium'])

    await waitFor(() => expect(screen.getByText('Сборка готова')).toBeTruthy(), { timeout: DONE_TIMEOUT })
    expect(screen.getByText(/Рекомендуемых модов установлено/)).toBeTruthy()
    expect(screen.getByText(/Fabric API/)).toBeTruthy()
  })

  it('lets the user switch a single mod off', async () => {
    vi.spyOn(api.mods, 'recommended').mockResolvedValue(PLAN)
    const install = vi.spyOn(api.mods, 'installRecommended').mockResolvedValue({ installed: [], dependencies: [], failed: [] })
    const user = userEvent.setup()
    const dialog = await openForm(user)
    await user.click(within(dialog).getByRole('button', { name: /^Создать/ }))
    await screen.findByText(TITLE)

    await user.click(screen.getByText('Lithium'))
    await user.click(await screen.findByRole('button', { name: /^Установить · 2/ }))
    await waitFor(() => expect(install).toHaveBeenCalledTimes(1), { timeout: 12000 })
    expect([...install.mock.calls[0][0].projectIds].sort()).toEqual(['id-modmenu', 'id-sodium'])
  })

  it('"Без модов" creates the instance without installing anything extra', async () => {
    vi.spyOn(api.mods, 'recommended').mockResolvedValue(PLAN)
    const install = vi.spyOn(api.mods, 'installRecommended')
    const user = userEvent.setup()
    const dialog = await openForm(user)
    const before = useAppStore.getState().instances.length
    await user.click(within(dialog).getByRole('button', { name: /^Создать/ }))
    await screen.findByText(TITLE)

    await user.click(screen.getByRole('button', { name: 'Без модов' }))
    await waitFor(() => expect(screen.getByText('Сборка готова')).toBeTruthy(), { timeout: DONE_TIMEOUT })
    expect(useAppStore.getState().instances.length).toBe(before + 1)
    expect(install).not.toHaveBeenCalled()
  })

  it('skips the window and still creates the instance when Modrinth is unavailable', async () => {
    vi.spyOn(api.mods, 'recommended').mockResolvedValue({ mcVersion: '1.21.4', loader: 'fabric', groups: [], unavailable: true })
    const install = vi.spyOn(api.mods, 'installRecommended')
    const user = userEvent.setup()
    const dialog = await openForm(user)
    await user.click(within(dialog).getByRole('button', { name: /^Создать/ }))

    // The info toast lives ~4 s, the mock install ~14 s: check it right away, not at the end.
    await waitFor(() =>
      expect(useAppStore.getState().toasts.some((toast) => toast.titleKey === 'toast.recommendedUnavailable')).toBe(true)
    )
    expect(screen.queryByText(TITLE)).toBeNull()
    await waitFor(() => expect(screen.getByText('Сборка готова')).toBeTruthy(), { timeout: DONE_TIMEOUT })
    expect(screen.queryByText(TITLE)).toBeNull()
    expect(install).not.toHaveBeenCalled()
  })

  it('does not show the window when nothing was found', async () => {
    vi.spyOn(api.mods, 'recommended').mockResolvedValue({ mcVersion: '1.21.4', loader: 'fabric', groups: [], unavailable: false })
    const user = userEvent.setup()
    const dialog = await openForm(user)
    await user.click(within(dialog).getByRole('button', { name: /^Создать/ }))
    await waitFor(() => expect(screen.getByText('Сборка готова')).toBeTruthy(), { timeout: DONE_TIMEOUT })
    expect(screen.queryByText(TITLE)).toBeNull()
  })
})
