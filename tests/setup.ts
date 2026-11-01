import { vi } from 'vitest'

class ObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): unknown[] {
    return []
  }
}

Object.assign(globalThis, { ResizeObserver: ObserverStub, IntersectionObserver: ObserverStub })
Element.prototype.scrollIntoView = vi.fn()
HTMLCanvasElement.prototype.getContext = (() => null) as never

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
