import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

/**
 * Dependencies stay external in the main build, which is how electron-vite is
 * meant to be used. The conversion worker therefore loads them from node_modules
 * at runtime, and the packaging config keeps node_modules outside the asar
 * archive so the worker, which also runs unpacked, can resolve them.
 */
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        // The main process plus the two workers that `utilityProcess.fork`
        // launches. Each worker needs its own entry: fork takes a file path.
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          'convert-worker': resolve(__dirname, 'src/main/workers/convert-worker.ts'),
          'zip-worker': resolve(__dirname, 'src/main/workers/zip-worker.ts'),
        },
        output: { entryFileNames: '[name].js' },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: {
      alias: { '@renderer': resolve(__dirname, 'src/renderer/src') },
    },
    plugins: [react()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') },
      },
    },
  },
})
