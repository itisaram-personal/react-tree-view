import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig(({ mode }) => {
  if (mode === 'lib') {
    return {
      plugins: [react()],
      build: {
        lib: {
          entry: resolve(__dirname, 'src/index.ts'),
          name: 'ReactTreeView',
          formats: ['es', 'cjs'],
          fileName: (format) => `react-tree-view.${format === 'es' ? 'js' : 'cjs'}`,
        },
        rollupOptions: {
          // Peer dependencies stay external so the host app keeps a single copy
          // of React, MUI and emotion.
          external: [/^react($|\/)/, /^react-dom($|\/)/, /^@mui\//, /^@emotion\//],
          output: {
            assetFileNames: (info) =>
              info.names?.[0]?.endsWith('.css') ? 'styles.css' : '[name][extname]',
            globals: { react: 'React', 'react-dom': 'ReactDOM' },
          },
        },
        emptyOutDir: false,
        sourcemap: true,
      },
    }
  }
  return {
    plugins: [react()],
    root: resolve(__dirname, 'demo'),
    build: { outDir: resolve(__dirname, 'dist-demo'), emptyOutDir: true },
    server: { open: true, port: 5199 },
  }
})
