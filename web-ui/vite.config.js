import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3099',
        changeOrigin: true,
      },
      '/images': {
        target: 'http://localhost:3099',
        changeOrigin: true,
      },
      '/avatars': {
        target: 'http://localhost:3099',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: '../agent-core/public',
    emptyOutDir: true,
  },
})
