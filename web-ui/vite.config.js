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
        // SSE 长连接在生图期间可能长时间无数据，禁用代理层超时
        timeout: 0,
        proxyTimeout: 0,
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
    rollupOptions: {
      output: {
        // 框架运行时单独分包（长缓存友好）；重库（vue-flow/html2canvas/lightbox）
        // 经 defineAsyncComponent/动态 import 自然形成独立 chunk
        manualChunks: {
          'vendor-vue': ['vue', 'vue-router', 'pinia'],
        },
      },
    },
  },
})
