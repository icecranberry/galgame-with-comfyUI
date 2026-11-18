import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { watchGameFiles } from '../scripts/lib/gameDevWatch.mjs'

function gameDevReload() {
  let stopWatching
  return {
    name: 'linshe-game-reload',
    apply: 'serve',
    configureServer(server) {
      stopWatching = watchGameFiles(changes => {
        // A backend change will refresh open games once the new process is ready.
        if (changes.some(change => change.backend)) return
        for (const { gameId, official } of changes) server.ws.send('linshe:game-reload', { gameId, official })
      })
    },
    closeBundle() { stopWatching?.() },
  }
}

export default defineConfig({
  plugins: [vue(), gameDevReload()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '^/docs/linshe_community_game_guide\\.md$': { target: 'http://localhost:3099', changeOrigin: true },
      '/game-assets': { target: 'http://localhost:3099', changeOrigin: true },
      '/game-media': { target: 'http://localhost:3099', changeOrigin: true },
      '/game-sdk.js': { target: 'http://localhost:3099', changeOrigin: true },
      '/api': {
        target: 'http://localhost:3099',
        changeOrigin: true,
        // SSE 长连接在生图期间可能长时间无数据，禁用代理层超时
        timeout: 0,
        proxyTimeout: 0,
        configure(proxy) {
          proxy.on('proxyRes', (upstream, req, res) => {
            if (!/^\/api\/games\/[^/]+\/events(?:\?|$)/.test(req.url)) return
            // End the SSE response when a dev restart cuts off the upstream socket.
            upstream.once('aborted', () => { if (!res.writableEnded) res.end() })
          })
        },
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
