/**
 * AI 小镇（世界页）store
 *
 * 数据流：REST 全量快照（进入页面 / SSE 重连时）+ unified SSE 的 town_* 增量事件。
 * 服务端权威：本 store 只保存"移动意图"（path + speed + 服务器基准时刻），
 * 渲染层用本地时钟插值，与后端 advanceAgent 公式一致。
 */
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import * as api from '../api/index.js'
import { onEvent } from './unifiedStream.js'

export const useTownStore = defineStore('town', () => {
  const snapshot = ref(null)
  const serverOffset = ref(0)      // serverTime - Date.now()
  const connected = ref(false)
  const loaded = ref(false)

  const map = computed(() => snapshot.value?.map ?? null)
  const locations = computed(() => snapshot.value?.locations ?? [])
  const agents = computed(() => snapshot.value?.agents ?? [])
  const player = computed(() => snapshot.value?.player ?? null)
  const weather = computed(() => snapshot.value?.weather ?? null)
  const encountersActive = computed(() => snapshot.value?.encountersActive ?? [])

  function _applyMove(d) {
    const snap = snapshot.value
    if (!snap || !d) return
    // 服务器时钟 → 本地时钟
    const startedAtLocal = (d.startedAt ?? Date.now()) - serverOffset.value
    if (d.charId === 'me') {
      snap.player = {
        ...snap.player,
        x: d.from?.x ?? snap.player?.x,
        y: d.from?.y ?? snap.player?.y,
        path: d.path || [],
        speed: d.speed ?? snap.player?.speed ?? 1.1,
        moveStartedAt: startedAtLocal,
      }
      return
    }
    const agent = snap.agents.find(a => a.characterId === d.charId)
    if (!agent) return
    agent.x = d.from?.x ?? agent.x
    agent.y = d.from?.y ?? agent.y
    agent.path = d.path || []
    agent.speed = d.speed ?? agent.speed
    agent.moveStartedAt = startedAtLocal
    // 走动中清掉旧站立气泡以外的瞬时展示状态
    if (d.path && d.path.length > 0) agent.sleeping = false
  }

  function _applyBubble(d) {
    const snap = snapshot.value
    if (!snap || !d) return
    const agent = snap.agents.find(a => a.characterId === d.charId)
    if (!agent) return
    if (!d.text) { agent.bubble = null; return }
    agent.bubble = {
      text: d.text,
      encounterId: d.encounterId ?? null,
      until: Date.now() + (d.ttl ?? 10) * 1000,
    }
  }

  function _applyEncounterStart(d) {
    const snap = snapshot.value
    if (!snap || !d) return
    for (const a of snap.agents) {
      if (a.characterId === d.a || a.characterId === d.b) a.encounterId = d.id
    }
    if (!snap.encountersActive.some(e => e.id === d.id)) {
      snap.encountersActive = [...snap.encountersActive, { id: d.id, a: d.a, b: d.b, locationId: d.locationId }]
    }
  }

  function _applyEncounterEnd(d) {
    const snap = snapshot.value
    if (!snap || !d) return
    for (const a of snap.agents) {
      if (a.encounterId === d.id) a.encounterId = null
    }
    snap.encountersActive = snap.encountersActive.filter(e => e.id !== d.id)
  }

  async function fetchState() {
    const data = await api.fetchTownState()
    serverOffset.value = (data.serverTime ?? Date.now()) - Date.now()
    // 快照里的 startedAt 是服务器时钟，换算成本地时钟供插值
    const nowLocal = Date.now()
    for (const a of data.agents) {
      if (a.path && a.path.length > 0) a.moveStartedAt = (a.startedAt ?? nowLocal) - serverOffset.value
      else a.moveStartedAt = nowLocal
      if (a.bubble) a.bubble.until = a.bubble.until - serverOffset.value
    }
    if (data.player) {
      data.player.moveStartedAt = data.player.path && data.player.path.length > 0
        ? (data.player.startedAt ?? nowLocal) - serverOffset.value
        : nowLocal
    }
    snapshot.value = data
    loaded.value = true
    // 快照拉取成功即可确认链路可用，不必等下一个心跳
    connected.value = true
    return data
  }

  async function movePlayer(x, y) {
    return api.moveTownPlayer(x, y)
  }

  // ── SSE 订阅（引用计数，TownView 挂载期间保持连接） ──
  let _refs = 0
  const _unsubs = []

  function startTownStream() {
    _refs++
    if (_refs > 1) return
    fetchState().catch(err => console.warn('[town] initial fetch failed:', err?.message))
    _unsubs.push(
      onEvent('connected', () => {
        connected.value = true
        // 重连后全量恢复快照，丢弃本地过渡状态
        fetchState().catch(() => {})
      }),
      onEvent('town_ping', () => { connected.value = true }),
      onEvent('town_move', _applyMove),
      onEvent('town_bubble', _applyBubble),
      onEvent('town_encounter_start', _applyEncounterStart),
      onEvent('town_encounter_end', _applyEncounterEnd),
    )
  }

  function stopTownStream() {
    _refs = Math.max(0, _refs - 1)
    if (_refs > 0) return
    while (_unsubs.length) _unsubs.pop()()
    connected.value = false
  }

  return {
    snapshot, serverOffset, connected, loaded,
    map, locations, agents, player, weather, encountersActive,
    fetchState, movePlayer, startTownStream, stopTownStream,
  }
})
