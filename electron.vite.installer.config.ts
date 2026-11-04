import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

/**
 * The bootstrapper is built separately from the launcher and lands in
 * `installer/app`, which electron-builder packages as its own (tiny) app with
 * the launcher payload attached as `resources/app.zip`.
 */
export default defineConfig({
  main: {
    // `yauzl` is bundled on purpose: the packaged bootstrapper has no
    // node_modules next to it, only main.js + the payload archive.
    plugins: [],
    build: {
      outDir: 'installer/app',
      emptyOutDir: false,
      rollupOptions: {
        input: { main: resolve('installer/main.ts') },
        // Only Electron itself stays external: the packaged bootstrapper is a
        // single main.js, so `yauzl` must be inside the bundle.
        external: ['electron'],
        output: { entryFileNames: 'main.js' }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'installer/app',
      emptyOutDir: false,
      rollupOptions: {
        input: { preload: resolve('installer/preload.ts') },
        output: { entryFileNames: 'preload.js' }
      }
    }
  },
  renderer: {
    root: 'installer/renderer',
    plugins: [react(), tailwindcss()],
    build: {
      outDir: resolve('installer/app/renderer'),
      emptyOutDir: true,
      rollupOptions: {
        input: { index: resolve('installer/renderer/index.html') }
      }
    }
  }
})
