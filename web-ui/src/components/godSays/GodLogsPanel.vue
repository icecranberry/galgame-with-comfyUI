<template>
  <linshe-modal v-model="visible" title="运行日志" full panel-class="god-logs-modal" body-class="god-logs-body" :transition-ms="300">
    <div class="logs-panel">
      <div class="logs-toolbar">
        <span class="logs-status">记录中 · 占用 {{ usedMB }}/{{ capMB }} MB · {{ entries.length }} 条</span>
        <div class="logs-toolbar-actions">
          <linshe-button variant="ghost" size="sm" :loading="refreshing" @click="manualRefresh">刷新</linshe-button>
          <linshe-button variant="ghost" size="sm" :tone="clearArmed ? 'danger' : 'muted'" :loading="clearing" @click="onClear">{{ clearArmed ? '确认清空' : '清空' }}</linshe-button>
        </div>
      </div>

      <div v-if="!entries.length" class="logs-empty">暂无日志</div>
      <div v-else class="logs-list" ref="listRef" @scroll.passive="onScroll">
        <div class="logs-spacer" :style="{ height: `${windowRange.before}px` }" aria-hidden="true"></div>
        <div v-for="entry in visibleEntries" :key="entry.seq" :ref="el => measureEntry(entry.seq, el)" v-memo="[entry, isOpen(entry.seq), blockRevision[entry.seq], renderEpoch]" class="log-item" :data-seq="entry.seq" :data-kind="entry.kind">
          <template v-if="entry.kind === 'llm'">
            <div
              class="log-card-head"
              role="button"
              tabindex="0"
              :aria-expanded="isOpen(entry.seq)"
              @click="toggle(entry.seq)"
              @keydown.enter.prevent="toggle(entry.seq)"
              @keydown.space.prevent="toggle(entry.seq)"
            >
              <span class="log-time">{{ fmtTime(entry.ts) }}</span>
              <span class="log-label">{{ entry.label || 'LLM' }}</span>
              <span v-if="entry.provider" class="log-provider">{{ entry.provider }}</span>
              <span class="log-usage">{{ usageBrief(entry) }}</span>
              <span class="log-chevron" :class="{ 'is-open': isOpen(entry.seq) }" aria-hidden="true">
                <svg viewBox="0 0 16 16" fill="none"><path d="m6 4 4 4-4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
              </span>
            </div>
            <collapse-transition :show="isOpen(entry.seq)">
              <div class="log-card-body">
                <template v-if="entry.parsed.messages !== null">
                  <section class="log-section">
                    <h5 class="log-section-title">输入消息 <span class="log-section-meta">{{ entry.parsed.messages.length }} 条</span></h5>
                    <div class="msg-list">
                      <template v-for="row in entry.rows" :key="row.key">
                        <div
                          v-if="row.type === 'folded'"
                          class="msg-fold"
                          role="button"
                          tabindex="0"
                          @click="toggleFold(row.key)"
                          @keydown.enter.prevent="toggleFold(row.key)"
                          @keydown.space.prevent="toggleFold(row.key)"
                        >
                          已折叠 {{ row.count }} 条固定内容（共 {{ row.chars }} 字）
                        </div>
                        <div v-else class="msg-row">
                          <div class="msg-heading">
                            <span class="msg-role" :data-role="row.role">{{ row.role }}</span>
                            <span class="msg-chars">{{ row.chars }} 字</span>
                          </div>
                          <GodLogText class="msg-text" :text="row.text" :expanded="isBlockOpen(row.key)" @toggle="toggleBlock(row.key)" />
                        </div>
                      </template>
                    </div>
                  </section>
                </template>
                <section v-else class="log-section">
                  <h5 class="log-section-title">原始日志 <span class="log-section-meta">{{ entry.text.length }} 字</span></h5>
                  <GodLogText class="log-raw" :text="entry.text" :expanded="isBlockOpen(`${entry.seq}:raw`)" @toggle="toggleBlock(`${entry.seq}:raw`)" />
                </section>

                <section v-if="entry.parsed.reasoning" class="log-section">
                  <h5 class="log-section-title">思考链 <span class="log-section-meta">{{ entry.parsed.reasoning.length }} 字</span></h5>
                  <GodLogText class="msg-text reasoning-text" :text="entry.parsed.reasoning" :expanded="isBlockOpen(`${entry.seq}:reasoning`)" @toggle="toggleBlock(`${entry.seq}:reasoning`)" />
                </section>

                <section v-if="entry.parsed.content" class="log-section">
                  <h5 class="log-section-title">正文 <span class="log-section-meta">{{ entry.parsed.content.length }} 字</span></h5>
                  <GodLogText class="msg-text" :text="entry.parsed.content" :expanded="isBlockOpen(`${entry.seq}:content`)" @toggle="toggleBlock(`${entry.seq}:content`)" />
                </section>
              </div>
            </collapse-transition>
          </template>
          <div v-else class="log-line" :data-level="entry.level || 'info'">
            <span class="log-time">{{ fmtTime(entry.ts) }}</span>
            <pre class="log-line-text">{{ entry.text }}</pre>
          </div>
        </div>

        <div class="logs-spacer" :style="{ height: `${windowRange.after}px` }" aria-hidden="true"></div>
      </div>
    </div>
  </linshe-modal>
</template>

<script setup>
import { ref, shallowRef, reactive, computed, watch, onBeforeUnmount } from 'vue'
import { getLogs, clearLogs } from '../../api/index.js'
import LinsheModal from '../ui/LinsheModal.vue'
import LinsheButton from '../ui/LinsheButton.vue'
import CollapseTransition from '../CollapseTransition.vue'
import GodLogText from './GodLogText.vue'
import { useLogVirtualList } from '../../composables/useLogVirtualList.js'
import { parseLlmBlock, classifyLabel, computeFolds, messageText } from '../../composables/useLogFolding.js'

const props = defineProps({ modelValue: Boolean })
const emit = defineEmits(['update:modelValue'])

const visible = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v)
})

const POLL_MS = 1500
const LOG_SOFT_CAP = 5242880

const entries = shallowRef([]) // 已按 seq 降序；日志不可变，避免为全文建立深层响应式代理。
const maxSeq = ref(0)
const totalBytes = ref(0)
const capBytes = ref(LOG_SOFT_CAP)
const listRef = ref(null)
const { windowRange, onScroll, measureEntry } = useLogVirtualList(entries, listRef)
const refreshing = ref(false)
const clearing = ref(false)
const clearArmed = ref(false)
const openMap = reactive({})
const foldOpenMap = reactive({})
const blockOpenMap = reactive({})
const blockRevision = reactive({})
const foldRevision = reactive({})
const renderEpoch = ref(0)

let timer = null
let clearArmTimer = null
const parseCache = new Map()
const viewCache = new Map()

function parseCached(entry) {
  const key = String(entry.seq)
  const cached = parseCache.get(key)
  if (cached?.source === entry.text) return cached.parsed
  let parsed
  try {
    parsed = parseLlmBlock(entry.text)
  } catch {
    parsed = { provider: '', label: '', messages: null, messagesRaw: '', reasoning: '', content: '', usage: '' }
  }
  parseCache.set(key, { source: entry.text, parsed })
  return parsed
}

function fmtTime(ts) {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function usageBrief(entry) {
  const parsed = parseCached(entry)
  const line = (parsed.usage || '').split('\n')[0]
  if (!line) return ''
  const text = line.replace(/^\[(?:cache|usage)\]\s*/, '')
  return text.length > 46 ? `${text.slice(0, 46)}…` : text
}

const usedMB = computed(() => (totalBytes.value / 1048576).toFixed(1))
const capMB = computed(() => Math.max(1, Math.round((capBytes.value || LOG_SOFT_CAP) / 1048576)))

function msgRow(messages, index, key) {
  const text = messageText(messages[index])
  const role = messages[index] && messages[index].role ? String(messages[index].role) : 'unknown'
  return { type: 'msg', key, role, chars: text.length, text }
}

function buildRows(entry) {
  const messages = Array.isArray(entry.parsed.messages) ? entry.parsed.messages : []
  const folds = (entry.folds && entry.folds.collapsedRanges) || []
  const rows = []
  let i = 0
  while (i < messages.length) {
    const range = folds.find((r) => r[0] === i)
    if (range) {
      const key = `${entry.seq}:${range[0]}`
      if (foldOpenMap[key]) {
        for (let k = range[0]; k <= range[1]; k += 1) rows.push(msgRow(messages, k, `${entry.seq}:m${k}`))
      } else {
        let chars = 0
        for (let k = range[0]; k <= range[1]; k += 1) chars += messageText(messages[k]).length
        rows.push({ type: 'folded', key, count: range[1] - range[0] + 1, chars })
      }
      i = range[1] + 1
    } else {
      rows.push(msgRow(messages, i, `${entry.seq}:m${i}`))
      i += 1
    }
  }
  return rows
}

const visibleEntries = computed(() => {
  void renderEpoch.value
  return entries.value.slice(windowRange.value.start, windowRange.value.end).map((entry) => {
    if (entry.kind !== 'llm') return entry
    const revision = foldRevision[entry.seq] || 0
    const cached = viewCache.get(entry.seq)
    if (cached?.source === entry && cached.revision === revision) return cached.view
    const parsed = parseCached(entry)
    const category = classifyLabel(entry.label || '')
    const folds = computeFolds(parsed.messages, category)
    const view = { ...entry, parsed, category, folds }
    view.rows = buildRows(view)
    viewCache.set(entry.seq, { source: entry, revision, view })
    return view
  })
})

// 外层日志卡片默认展开，保留用户手动开合状态。
function isOpen(seq) {
  return openMap[String(seq)] !== false
}
function toggle(seq) {
  const k = String(seq)
  openMap[k] = !isOpen(seq)
}
function toggleFold(key) {
  foldOpenMap[key] = !foldOpenMap[key]
  const seq = key.split(':')[0]
  foldRevision[seq] = (foldRevision[seq] || 0) + 1
}
// 每条输入、思考链、正文默认预览四行，独立展开并随日志列表统一滚动。
function isBlockOpen(key) {
  return blockOpenMap[key] === true
}
function toggleBlock(key) {
  blockOpenMap[key] = !isBlockOpen(key)
  const seq = key.split(':')[0]
  blockRevision[seq] = (blockRevision[seq] || 0) + 1
}

async function pull(after) {
  const data = await getLogs(after)
  const list = Array.isArray(data && data.entries) ? data.entries : []
  if (list.length || !after) {
    const previous = new Map(entries.value.map(e => [e.seq, e]))
    const map = after ? new Map(previous) : new Map()
    for (const entry of list) {
      const old = previous.get(entry.seq)
      const same = old && ['text', 'ts', 'kind', 'label', 'provider', 'level'].every(key => old[key] === entry[key])
      map.set(entry.seq, same ? old : entry)
    }
    const next = [...map.values()].sort((a, b) => b.seq - a.seq)
    if (next.length !== entries.value.length || next.some((entry, i) => entry !== entries.value[i])) entries.value = next
    for (const key of parseCache.keys()) if (!map.has(Number(key))) parseCache.delete(key)
    for (const key of viewCache.keys()) if (!map.has(key)) viewCache.delete(key)
  }
  const nextMax = Number(data && data.maxSeq)
  if (Number.isFinite(nextMax)) maxSeq.value = Math.max(maxSeq.value, nextMax)
  const tb = Number(data && data.totalBytes)
  if (Number.isFinite(tb)) totalBytes.value = tb
  const cb = Number(data && data.capBytes)
  if (Number.isFinite(cb) && cb > 0) capBytes.value = cb
}

async function manualRefresh() {
  refreshing.value = true
  try {
    await pull(0)
  } catch {
    /* 轮询失败静默 */
  } finally {
    refreshing.value = false
  }
}

function stopTimer() {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

function startPolling() {
  stopTimer()
  timer = setInterval(async () => {
    try {
      await pull(maxSeq.value || 0)
    } catch {
      /* 轮询失败静默，等下一次 */
    }
  }, POLL_MS)
}

async function onClear() {
  if (!clearArmed.value) {
    clearArmed.value = true
    if (clearArmTimer) clearTimeout(clearArmTimer)
    clearArmTimer = setTimeout(() => {
      clearArmed.value = false
    }, 3000)
    return
  }
  clearArmed.value = false
  if (clearArmTimer) {
    clearTimeout(clearArmTimer)
    clearArmTimer = null
  }
  clearing.value = true
  try {
    await clearLogs()
    entries.value = []
    maxSeq.value = 0
    totalBytes.value = 0
    parseCache.clear()
    viewCache.clear()
  } catch {
    /* 清空失败静默 */
  } finally {
    clearing.value = false
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      viewCache.clear()
      renderEpoch.value++
      for (const map of [foldOpenMap, blockOpenMap]) {
        for (const key of Object.keys(map)) delete map[key]
      }
      pull(0).catch(() => {})
      startPolling()
    } else {
      stopTimer()
    }
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  stopTimer()
  if (clearArmTimer) clearTimeout(clearArmTimer)
})
</script>

<style scoped>
.logs-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: min(72vh, 860px);
  min-height: 0;
  color: var(--text-primary);
  font-size: var(--fs-base);
}
.logs-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 8px 12px;
  background: var(--bg-sunken);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}
.logs-status {
  font-size: var(--fs-sm);
  line-height: 1.6;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}
.logs-toolbar-actions {
  display: flex;
  gap: 8px;
}
.logs-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  font-size: var(--fs-md);
}
.logs-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-anchor: none;
  padding-right: 4px;
}
.log-item {
  min-width: 0;
  margin-bottom: 8px;
}
.logs-spacer { pointer-events: none; }
.log-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  cursor: pointer;
  user-select: none;
  transition: background-color 0.3s var(--ease-out, ease), border-color 0.3s var(--ease-out, ease);
}
.log-card-head:hover {
  background: var(--bg-hover);
  border-color: var(--border-strong);
}
.log-time {
  flex-shrink: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: var(--fs-xs);
  color: var(--text-secondary);
}
.log-label {
  flex-shrink: 0;
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--text-primary);
}
.log-provider {
  flex-shrink: 0;
  padding: 1px 6px;
  font-size: var(--fs-xs);
  color: var(--accent);
  background: rgba(var(--accent-rgb), 0.12);
  border-radius: var(--radius-full);
}
.log-usage {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-align: right;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--fs-xs);
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}
.log-chevron {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  color: var(--text-secondary);
  transition: transform 0.3s var(--ease-out, ease);
}
.log-chevron.is-open {
  transform: rotate(90deg);
}
.log-chevron svg {
  width: 14px;
  height: 14px;
}
.log-card-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 6px;
  padding: 10px 12px;
  background: var(--bg-sunken);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}
.log-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.log-section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: var(--fs-sm);
  font-weight: 600;
  line-height: 1.5;
  color: var(--text-secondary);
}
.log-section-meta {
  font-size: var(--fs-xs);
  font-weight: 400;
  color: var(--text-secondary);
  opacity: 0.8;
}
.msg-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.msg-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 6px 8px;
  align-items: baseline;
  padding: 6px 8px;
  background: var(--bg-primary);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
.msg-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.msg-role {
  padding: 1px 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: var(--fs-xs);
  line-height: 1.5;
  color: var(--accent);
  background: rgba(var(--accent-rgb), 0.12);
  border-radius: var(--radius-sm);
}
.msg-role[data-role='system'] {
  color: var(--text-secondary);
  background: var(--bg-tertiary);
}
.msg-role[data-role='assistant'] {
  color: var(--fun-gold);
  background: var(--bg-tertiary);
}
.msg-chars {
  font-size: var(--fs-xs);
  color: var(--text-secondary);
}
.msg-text {
  grid-column: 1 / -1;
  margin: 0;
  overflow: visible;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
  font-family: inherit;
  font-size: var(--fs-base);
  line-height: 1.7;
  color: var(--text-primary);
}
.reasoning-text {
  padding-left: 10px;
  color: var(--text-secondary);
  border-left: 2px solid var(--accent);
}
.msg-fold {
  padding: 6px 10px;
  text-align: center;
  font-size: var(--fs-sm);
  color: var(--text-secondary);
  background: var(--bg-tertiary);
  border: 1px dashed var(--border-strong);
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: background-color 0.3s var(--ease-out, ease), color 0.3s var(--ease-out, ease);
}
.msg-fold:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}
.log-raw {
  margin: 0;
  overflow: visible;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: var(--fs-sm);
  line-height: 1.7;
  color: var(--text-secondary);
}
.log-line {
  display: flex;
  gap: 8px;
  padding: 6px 10px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-left: 3px solid var(--border-strong);
  border-radius: var(--radius-sm);
  font-size: var(--fs-sm);
  line-height: 1.6;
}
.log-line[data-level='error'] {
  border-left-color: var(--danger);
}
.log-line[data-level='warn'] {
  border-left-color: var(--warning);
}
.log-line[data-level='error'] .log-line-text {
  color: var(--danger);
}
.log-line[data-level='warn'] .log-line-text {
  color: var(--warning);
}
.log-line-text {
  flex: 1;
  min-width: 0;
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: var(--fs-sm);
  line-height: 1.6;
  color: var(--text-secondary);
}
@media (max-width: 767px) {
  .logs-panel {
    flex: 1;
    min-width: 0;
    height: auto;
    gap: 8px;
  }
  .logs-toolbar {
    gap: 6px;
    padding: 6px;
  }
  .logs-list {
    padding-right: 2px;
    scrollbar-width: auto;
    scrollbar-color: auto;
    scrollbar-gutter: stable;
  }
  .logs-list::-webkit-scrollbar { width: 12px; }
  .logs-list::-webkit-scrollbar-track { background: var(--bg-sunken); }
  .logs-list::-webkit-scrollbar-thumb {
    min-height: 44px;
    background: rgba(var(--accent-rgb), 0.45);
    border: 2px solid var(--bg-sunken);
    border-radius: var(--radius-full);
  }
  .logs-list::-webkit-scrollbar-thumb:hover,
  .logs-list::-webkit-scrollbar-thumb:active {
    background: var(--accent);
  }
  @supports not selector(::-webkit-scrollbar) {
    .logs-list { scrollbar-color: rgba(var(--accent-rgb), 0.45) var(--bg-sunken); }
  }
  .log-card-head {
    flex-wrap: wrap;
    gap: 6px;
    padding: 8px 6px;
  }
  .log-label,
  .log-provider {
    flex-shrink: 1;
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .log-chevron { margin-left: auto; }
  .log-card-body {
    padding: 8px 6px;
  }
  .msg-row {
    padding: 6px;
  }
  .reasoning-text {
    padding-left: 6px;
  }
  .log-line {
    gap: 6px;
    padding: 6px;
  }
  .log-usage {
    display: none;
  }
}
</style>
