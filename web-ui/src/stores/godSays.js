import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import * as api from '../api/index.js'
import { createClientRequestId } from '../utils/clientRequestId.js'

export function applyGodStreamEvent(state, event) {
  const { type, data } = event
  if (type === 'message') {
    const index = state.messages.findIndex(m => m.id === data.id)
    if (index < 0) state.messages.push(data)
    else state.messages[index] = data
  } else if (type === 'delta') {
    const msg = state.messages.find(m => m.id === data.id)
    if (msg && ['content', 'reasoning'].includes(data.field)) msg[data.field] = (msg[data.field] || '') + data.text
  } else if (type === 'tool') {
    const index = state.calls.findIndex(c => c.id === data.id)
    if (index < 0) state.calls.push(data)
    else state.calls[index] = data
  } else if (type === 'run_end') {
    const run = state.runs.find(r => r.id === data.id)
    if (run) Object.assign(run, data)
  }
}

function readLocal(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) || fallback } catch { return fallback } }
function saveLocal(key, value) { try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* 存储不可用时仍可聊天 */ } }

export const useGodSaysStore = defineStore('god-says', () => {
  const state = ref(null)
  const loading = ref(false)
  const submitting = ref(false)
  const stopping = ref(false)
  const deleting = ref(false)
  const creating = ref(false)
  const reconnecting = ref(false)
  const error = ref('')
  const draft = ref(readLocal('linshe.god.draft', ''))
  const archiveId = ref(null)
  let source
  let epoch = 0
  let cursor = 0
  const activeRun = computed(() => state.value?.runs.find(r => r.status === 'running'))
  const busy = computed(() => submitting.value || creating.value || !!activeRun.value)
  const turns = computed(() => (state.value?.runs || []).map(run => ({ ...run,
    messages: state.value.messages.filter(m => m.run_id === run.id),
    calls: state.value.calls.filter(c => c.run_id === run.id),
    work: [...(state.value.changes || []), ...(state.value.batches || [])].filter(w => w.run_id === run.id),
    events: (state.value.worldEvents || []).filter(e => e.run_id === run.id),
  })))
  function detach() { source?.close(); source = null; reconnecting.value = false }
  function suspend() { ++epoch; detach(); loading.value = false }
  function connect(run) {
    detach()
    const generation = epoch
    const connection = new EventSource(`/api/god-says/runs/${run.id}/stream?after=${cursor}`)
    source = connection
    connection.onopen = () => { if (source === connection) reconnecting.value = false }
    connection.onerror = () => { if (source === connection) reconnecting.value = true }
    connection.onmessage = event => {
      if (generation !== epoch || source !== connection) return
      const next = Number(event.lastEventId)
      if (next && next <= cursor) return
      if (next) cursor = next
      let data
      try { data = JSON.parse(event.data) } catch { return }
      applyGodStreamEvent(state.value, data)
      if (data.type === 'run_end') { detach(); stopping.value = false; void refreshWorld(); void refreshWork() }
    }
  }
  async function load(session = null) {
    const generation = ++epoch
    detach(); loading.value = true; error.value = ''
    try {
      const result = await api.getGodSaysState(session)
      if (generation !== epoch) return
      state.value = result
      cursor = result.cursor
      const writable = result.writable !== false
      archiveId.value = writable ? null : result.session?.id ?? session
      if (activeRun.value) connect(activeRun.value)
    } catch (err) { if (generation === epoch) error.value = err.message }
    finally { if (generation === epoch) loading.value = false }
  }
  function setDraft(text) { draft.value = text; saveLocal('linshe.god.draft', text) }
  async function newConversation() {
    if (busy.value || loading.value || deleting.value || !state.value) return false
    // 已在唯一的空白会话中时，连请求都不重复；文字和附图草稿原样保留。
    if (!archiveId.value && state.value.current && !turns.value.length) return false
    creating.value = true; error.value = ''
    try {
      await api.createGodSaysSession()
      saveLocal('linshe.god.pending', null)
      await load()
      return !error.value
    } catch (err) { error.value = err.message; return false }
    finally { creating.value = false }
  }
  async function send(images = []) {
    const text = draft.value.trim()
    const attachments = Array.isArray(images) ? images.filter(Boolean) : []
    if ((!text && !attachments.length) || busy.value || archiveId.value || deleting.value || loading.value) return
    submitting.value = true; error.value = ''
    const generation = epoch
    const sessionId = state.value?.session?.id ?? null
    try {
      const previous = readLocal('linshe.god.pending', null)
      const samePending = previous?.text === text && (previous.session_id ?? null) === sessionId && JSON.stringify(previous?.images || []) === JSON.stringify(attachments)
      const pending = samePending ? previous : { client_id: createClientRequestId(), text, images: attachments, session_id: sessionId }
      saveLocal('linshe.god.pending', pending)
      const { run } = await api.sendGodSaysMessage(pending.client_id, text, attachments, sessionId)
      saveLocal('linshe.god.pending', null)
      if (generation !== epoch) return
      if (draft.value.trim() === text) setDraft('')
      // 始终读回受理消息所属会话，继续历史会话时不能跳到最新会话。
      await load(run.session_id)
      return run
    } catch (err) { error.value = err.message }
    finally { submitting.value = false }
  }
  async function stop() {
    if (!activeRun.value || stopping.value) return
    const target = activeRun.value
    stopping.value = true
    try { await api.stopGodSaysRun(target.id) }
    catch (err) { error.value = err.message; stopping.value = false; return }
    // SSE 若已断开可能收不到 run_end，stopping/activeRun 会永久卡死：延时对账，必要时强制复位。
    setTimeout(async () => {
      if (activeRun.value?.id !== target.id) return
      try { await load(target.session_id) } catch { /* 网络仍不可用，走下面强制复位 */ }
      if (activeRun.value?.id === target.id) { target.status = 'cancelled'; stopping.value = false }
    }, 6000)
  }
  async function deleteTurn(id) {
    if (deleting.value || busy.value) return false
    deleting.value = true; error.value = ''
    const session = state.value?.session.id
    try {
      await api.deleteGodSaysTurn(id)
      if (state.value?.session.id === session) {
        state.value.runs = state.value.runs.filter(r => r.id !== id)
        state.value.messages = state.value.messages.filter(m => m.run_id !== id)
        state.value.calls = state.value.calls.filter(c => c.run_id !== id)
        Object.assign(state.value.session, { summary: '', memories_json: '[]', summary_status: 'pending' })
      }
      return true
    } catch (err) { error.value = err.message; return false }
    finally { deleting.value = false }
  }
  async function refreshWork() {
    const session = state.value?.session.id
    if (!session) return
    try { const result = await api.getGodWork(session); if (state.value?.session.id === session) Object.assign(state.value, result) }
    catch { /* 下次轮询恢复 */ }
  }
  async function refreshWorld() {
    const session = state.value?.session.id
    if (!session) return
    try { const events = await api.getGodWorldEvents(session); if (state.value?.session.id === session) state.value.worldEvents = events }
    catch { /* SSE/下次刷新会恢复，保留已有结果 */ }
  }
  async function refreshActivity() {
    const generation = epoch
    if (archiveId.value) return
    try { const result = await api.getGodAngelActivity(); if (generation === epoch && state.value && !archiveId.value) Object.assign(state.value, result) }
    catch { /* 下次轮询恢复 */ }
  }
  function updateWorld(event) {
    if (!state.value) return
    const index = state.value.worldEvents.findIndex(e => e.id === event.id)
    if (index < 0) state.value.worldEvents.unshift(event)
    else state.value.worldEvents[index] = event
  }
  return { state, loading, submitting, stopping, deleting, creating, reconnecting, error, draft, archiveId, activeRun, busy, turns, load, newConversation, send, stop, deleteTurn, setDraft, detach, suspend, refreshWorld, refreshActivity, refreshWork, updateWorld }
})
