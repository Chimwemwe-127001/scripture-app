import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        // companion: the second laptop's program (see electron-builder.companion.json)
        input: { index: 'src/main/index.js', companion: 'src/main/companion.js' },
        external: ['electron'],
        output: { format: 'cjs', entryFileNames: '[name].js', chunkFileNames: 'chunks/[name].js' }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [react(), tailwindcss()]
  }
})
