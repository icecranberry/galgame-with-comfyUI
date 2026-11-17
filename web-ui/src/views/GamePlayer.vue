<template>
  <main class="game-theme game-player" :class="{ 'is-leaving': leaving }">
    <iframe v-if="game && !error" ref="frame" :src="game.entryUrl" :title="game.name" sandbox="allow-scripts" referrerpolicy="same-origin" />
    <div v-if="error || game?.source !== 'official' || game?.id !== 'trpg-simulator'" class="game-exit"><GameAction variant="quiet" compact @click="exit">← 游戏馆</GameAction></div>
    <div v-if="error" class="game-error" role="alert">{{ error }}</div>
  </main>
</template>
<script setup>
import { inject, ref, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import GameAction from '../games/components/GameAction.vue'
import '../games/styles/game-ui.css'
import { gameRequest } from '../api/games.js'
const route = useRoute(), router = useRouter(), frame = ref(null), game = ref(null), error = ref('')
const openGameStandings = inject('openGameStandings')
const base = `/${encodeURIComponent(route.params.gameId)}`, abort = new AbortController()
let channel = crypto.randomUUID()
const seen = new Set(); let inFlight = 0
let events
const leaving = ref(false)
let exitTimer
const exit = () => {
  if (leaving.value) return
  leaving.value = true
  exitTimer = setTimeout(() => router.push('/games'), window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 300)
}
const request = (path, options) => gameRequest(base + path, { ...options, signal: abort.signal })
async function dispatch(method, args) {
  const id = () => { if (!/^[\w-]{1,80}$/.test(args.sessionId)) throw new Error('无效存档编号'); return encodeURIComponent(args.sessionId) }
  switch (method) {
    case 'bridge': return request('/sdk/bridge', { method: 'POST', body: args })
    case 'llm': return request('/sdk/llm', { method: 'POST', body: args })
    case 'image': return request('/sdk/image', { method: 'POST', body: args })
    case 'promote': return request('/media/promote-to-album', { method: 'POST', body: args })
    case 'save.list': return request('/sessions')
    case 'save.load': return request(`/sessions/${id()}`)
    case 'save.write': return request(`/sessions/${id()}`, { method: 'POST', body: args })
    case 'save.delete': return request(`/sessions/${id()}`, { method: 'DELETE' })
    case 'exit': exit(); return { ok: true }
    case 'standings': {
      const { subject } = args
      if (game.value?.id !== 'trpg-simulator' || game.value.source !== 'official' || (subject !== 'player' && (!Number.isSafeInteger(subject) || subject < 1))) {
        throw new Error('立绘管理入口不可用')
      }
      const target = frame.value?.contentWindow, requestChannel = channel
      await openGameStandings(subject, () => {
        if (target && frame.value?.contentWindow === target && channel === requestChannel) {
          target.postMessage({ type: 'standing-assets', channel, rpcType: 'event' }, '*')
        }
      })
      return { ok: true }
    }
    case 'ext': {
      const subPath = args.subPath
      if (typeof subPath !== 'string' || !/^\/[a-zA-Z0-9_/-]*(?:\?[^#]*)?$/.test(subPath) || subPath.includes('//') || subPath.includes('..')) throw new Error('扩展接口路径无效')
      const options = args.fetchOptions || {}, method = String(options.method || 'GET').toUpperCase()
      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) throw new Error('请求方法不支持')
      const body = typeof options.body === 'string' ? JSON.parse(options.body) : options.body
      return request('/ext' + subPath, { method, body })
    }
    default: throw new Error('SDK 方法不支持')
  }
}
async function receive(event) {
  if (event.source !== frame.value?.contentWindow || event.origin !== 'null') return
  const data = event.data
  if (data?.type === 'linshe:game:ready') { channel = crypto.randomUUID(); seen.clear(); frame.value.contentWindow.postMessage({ type: 'linshe:host:init', channel }, '*'); return }
  if (data?.type !== 'linshe:rpc' || data.channel !== channel || !Number.isSafeInteger(data.id) || seen.has(data.id)) return
  const target = event.source, requestChannel = channel, reply = result => target.postMessage({ type: 'linshe:rpc:result', channel: requestChannel, id: data.id, ...result }, '*')
  if (inFlight >= 16 || JSON.stringify(data).length > 5 * 1024 * 1024) { reply({ error: '游戏请求过多或数据过大' }); return }
  seen.add(data.id); if (seen.size > 10000) seen.delete(seen.values().next().value)
  inFlight++
  try { reply({ result: await dispatch(data.method, data.args || {}) }) } catch (error) { reply({ error: error.message }) } finally { inFlight-- }
}
onMounted(async () => {
  window.addEventListener('message', receive)
  try {
    game.value = await gameRequest(base, { signal: abort.signal }); if (!game.value.enabled || !game.value.compatible) throw new Error('游戏已停用或版本不兼容')
    events = new EventSource(`/api/games${base}/events`)
    events.onmessage = event => { try { frame.value?.contentWindow?.postMessage({ type: 'linshe:event', channel, ...JSON.parse(event.data) , rpcType: 'event' }, '*') } catch { /* Ignore an incomplete server event. */ } }
  }
  catch (e) { error.value = e.message }
})
onBeforeUnmount(() => { window.removeEventListener('message', receive); abort.abort(); events?.close(); clearTimeout(exitTimer) })
</script>
<style scoped>
.game-player { position: fixed; inset: 0; width: 100vw; height: 100dvh; background: var(--game-bg); animation: game-in .3s ease; transition: opacity .3s ease; }
.game-player.is-leaving { opacity: 0; pointer-events: none; }
iframe { width: 100%; height: 100%; border: 0; display: block; }
.game-exit { position: absolute; left: max(12px, env(safe-area-inset-left)); top: max(10px, env(safe-area-inset-top)); opacity: .85; transition: opacity .3s; background:#101c24a8;backdrop-filter:blur(10px); }
.game-exit:hover, .game-exit:focus-within { opacity: 1; }
.game-error { display: grid; place-items: center; height: 100%; padding: 32px; color: var(--game-cream);font-size:15px;line-height:1.8; }
@keyframes game-in { from { opacity: 0; } to { opacity: 1; } }
</style>
