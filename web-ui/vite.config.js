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
      // 小镇像素素材（data/town/assets，由 agent-core 静态服务）
      '/town-assets': {
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
        // 小镇渲染包（Hd2dTownRenderer，动态 import）依赖的一批纯计算模块，
        // 若留在入口包里，入口包的文件名会被写进渲染包内容，入口任何改动都会
        // 连带重建渲染包。这里把它们固定成一个自足分包，让两侧都引用稳定的文件名。
        manualChunks(id) {
          const normalized = id.replace(/\\/g, '/')
          const sharedModules = [
            'projection.js',
            'groundTexture.js',
            'imageAlpha.js',
            'TownSceneAdapter.js',
            'buildingVolumeProfile.js',
            'agentMotion.js',
          ]
          if (sharedModules.some((name) => normalized.endsWith(`/src/town/renderers/${name}`))) {
            return 'town-shared'
          }
          return undefined
        },
      },
    },
  },
})
