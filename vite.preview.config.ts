import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * Browser-only preview of the renderer. `window.launcher` is absent there, so
 * `src/renderer/src/lib/api.ts` falls back to an in-memory mock backend.
 * Handy for UI review without launching Electron.
 */
export default defineConfig({
  root: resolve('src/renderer'),
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src'),
      '@shared': resolve('src/shared')
    }
  },
  server: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: true,
    allowedHosts: true,
    fs: { allow: [resolve('src')] }
  },
  build: {
    outDir: resolve('out/preview'),
    emptyOutDir: true
  }
})
