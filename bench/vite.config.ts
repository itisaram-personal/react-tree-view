import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [react()],
  root: resolve(__dirname),
  server: { port: 5210, open: false },
  build: { outDir: resolve(__dirname, '../dist-bench'), emptyOutDir: true },
})
