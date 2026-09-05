<template>
  <Teleport to="body">
    <!-- 布局确认阶段：底部紧凑条，把画面让给预览 -->
    <div v-if="step === 'confirm'" class="wiz-confirm">
      <div class="wiz-confirm-body">
        <div class="wiz-step-tag">布图已生成 · 背后就是实时预览</div>
        <div class="wiz-confirm-actions">
          <linshe-button variant="primary" :loading="busy" @click="confirmInit">确认开镇</linshe-button>
          <linshe-button variant="secondary" :loading="busy" @click="reroll">重掷布局</linshe-button>
          <linshe-button variant="ghost" @click="cancel">先等等</linshe-button>
        </div>
      </div>
    </div>

    <!-- 常规向导面板 -->
    <div v-else class="wiz-mask" @click.self="tryClose">
      <div class="wiz-panel" role="dialog" aria-label="小镇初始化向导">
        <div class="wiz-head">
          <span class="wiz-title">小镇初始化</span>
          <span class="wiz-step-hint">{{ stepHint }}</span>
          <linshe-button variant="icon" size="sm" aria-label="关闭" @click="tryClose">✕</linshe-button>
        </div>

        <!-- 步骤条 -->
        <div class="wiz-steps">
          <span
            v-for="(s, i) in STEP_LIST" :key="s.id"
            class="wiz-step" :class="{ 'is-active': stepIndex === i, 'is-done': stepIndex > i }"
          >{{ i + 1 }}. {{ s.label }}</span>
        </div>

        <div class="wiz-body">
          <!-- 1. 配置 -->
          <template v-if="step === 'config'">
            <p class="wiz-desc">选一套世界观，AI 会据此生成像素素材、规划小镇布局、安排一批居民。</p>
            <div class="wiz-field">
              <span class="wiz-label">世界观</span>
              <linshe-select v-model="form.worldSettingId" :options="worldOptions" size="md" />
            </div>
            <div class="wiz-field">
              <span class="wiz-label">居民数量</span>
              <linshe-input v-model.number="form.npcCount" size="md" type="number" min="3" max="16" />
            </div>
            <div class="wiz-field">
              <span class="wiz-label">地图规格</span>
              <div class="wiz-inline">
                <linshe-input v-model.number="form.mapCols" size="md" type="number" min="30" max="80" />
                <span class="wiz-x">×</span>
                <linshe-input v-model.number="form.mapRows" size="md" type="number" min="30" max="80" />
              </div>
            </div>
            <div class="wiz-error" v-if="initState?.error">{{ initState.error }}</div>
            <linshe-button variant="primary" class="wiz-go" :loading="busy" @click="start">生成蓝图</linshe-button>
          </template>

          <!-- 2/3. 蓝图确认 + 小样 -->
          <template v-else-if="step === 'blueprint'">
            <p class="wiz-desc">AI 已给出素材清单与居民名册，可以直接增删调整（改动会同步到生成队列）。</p>
            <div class="wiz-field">
              <span class="wiz-label">风格基调（styleTags，所有素材共享）</span>
              <linshe-input v-model="bpForm.styleTags" size="sm" placeholder="warm pastel fantasy village, soft colors" />
            </div>
            <div v-for="sec in SECTIONS" :key="sec.id" class="wiz-section">
              <div class="wiz-section-title">{{ sec.label }}</div>
              <div v-for="(item, i) in bpForm[sec.id]" :key="item.key || i" class="wiz-item">
                <div class="wiz-item-main">
                  <span class="wiz-item-name">{{ item.name }}</span>
                  <span class="wiz-item-desc">{{ item.desc }}</span>
                </div>
                <span class="wiz-item-op" role="button" title="移除" @click="bpForm[sec.id].splice(i, 1)">✕</span>
              </div>
            </div>
            <div class="wiz-section">
              <div class="wiz-section-title">居民（{{ bpForm.npcs.length }} 位）</div>
              <div v-for="(n, i) in bpForm.npcs" :key="i" class="wiz-item">
                <div class="wiz-item-main">
                  <span class="wiz-item-name">{{ n.displayName }}<template v-if="n.job"> · {{ n.job }}</template></span>
                  <span class="wiz-item-desc">{{ n.persona }}</span>
                </div>
                <span class="wiz-item-op" role="button" title="移除" @click="bpForm.npcs.splice(i, 1)">✕</span>
              </div>
            </div>
            <div class="wiz-error" v-if="initState?.error">{{ initState.error }}</div>
            <div class="wiz-actions">
              <linshe-button variant="secondary" :loading="busy" @click="saveBlueprint">保存修改</linshe-button>
              <linshe-button variant="primary" :loading="busy" @click="genSamples">出风格小样</linshe-button>
            </div>
          </template>

          <!-- 3. 风格小样确认 -->
          <template v-else-if="step === 'samples'">
            <p class="wiz-desc">这是用当前风格生成的三张小样，满意就批量，不满意可以调整风格后重出。</p>
            <div class="wiz-samples">
              <div v-for="a in initState?.sampleAssets || []" :key="a.id" class="wiz-sample">
                <img :src="a.imagePath" :alt="a.name">
                <span>{{ a.name }}</span>
              </div>
            </div>
            <div class="wiz-field">
              <span class="wiz-label">调整风格（改完重出小样）</span>
              <linshe-input v-model="bpForm.styleTags" size="sm" />
            </div>
            <div class="wiz-actions">
              <linshe-button variant="secondary" :loading="busy" @click="regenSamples">调整后重出</linshe-button>
              <linshe-button variant="primary" :loading="busy" @click="startBatch">满意，开始批量生成</linshe-button>
            </div>
          </template>

          <!-- 4. 批量生成 -->
          <template v-else-if="step === 'batch'">
            <p class="wiz-desc">正在批量生成整套素材（地砖 → 建筑 → 道具），完成一张上报一张，请耐心等待。</p>
            <div class="wiz-progress">
              <div class="wiz-progress-bar">
                <div class="wiz-progress-fill" :style="{ width: progressPct + '%' }"></div>
              </div>
              <span class="wiz-progress-text">{{ progress.done || 0 }} / {{ progress.total || '…' }}</span>
            </div>
            <div class="wiz-current" v-if="progress.current">正在生成：{{ progress.current }}</div>
            <div v-if="(initState?.warnings || []).length" class="wiz-warnings">
              <div v-for="(w, i) in initState.warnings" :key="i" class="wiz-warning">⚠️ {{ w }}</div>
            </div>
            <div class="wiz-error" v-if="initState?.error">{{ initState.error }}</div>
            <div class="wiz-actions" v-if="initState?.status === 'failed'">
              <linshe-button variant="primary" :loading="busy" @click="startBatch">重试批量</linshe-button>
            </div>
          </template>

          <!-- 5. 布图 -->
          <template v-else-if="step === 'layout'">
            <p class="wiz-desc">素材齐了。AI 将根据素材清单规划整张小镇布局（道路/建筑/地点/居民落位）。</p>
            <div class="wiz-error" v-if="initState?.error">{{ initState.error }}</div>
            <div class="wiz-actions">
              <linshe-button variant="primary" :loading="busy" @click="genLayout">生成布局</linshe-button>
            </div>
          </template>

          <!-- 进行中（蓝图/布图 LLM 调用） -->
          <template v-else-if="step === 'working'">
            <p class="wiz-desc">{{ workingText }}</p>
            <div class="wiz-working">
              <span class="wiz-working-dot"></span>
              AI 正在思考，大约需要十几秒…
            </div>
          </template>

          <!-- 完成 -->
          <template v-else-if="step === 'done'">
            <p class="wiz-desc">小镇已经开张！居民们正在按作息生活。</p>
            <linshe-button variant="primary" class="wiz-go" @click="finish">进入小镇</linshe-button>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import * as api from '../../api/index.js'
import { useTownStore } from '../../stores/town.js'
import LinsheButton from '../ui/LinsheButton.vue'
import LinsheInput from '../ui/LinsheInput.vue'
import LinsheSelect from '../ui/LinsheSelect.vue'

const emit = defineEmits(['close', 'applied'])

const town = useTownStore()
const busy = ref(false)
const worldOptions = ref([{ label: '（跟随当前激活世界观）', value: null }])

const form = reactive({ worldSettingId: null, npcCount: 8, mapCols: 50, mapRows: 50 })
const bpForm = reactive({ styleTags: '', groundAssets: [], roadAssets: [], buildings: [], props: [], npcs: [] })

const STEP_LIST = [
  { id: 'config', label: '配置' },
  { id: 'blueprint', label: '蓝图' },
  { id: 'samples', label: '小样' },
  { id: 'batch', label: '批量' },
  { id: 'layout', label: '布图' },
  { id: 'confirm', label: '确认' },
]

const SECTIONS = [
  { id: 'groundAssets', label: '地砖' },
  { id: 'roadAssets', label: '道路' },
  { id: 'buildings', label: '建筑' },
  { id: 'props', label: '道具' },
]

const initState = computed(() => town.initState)
const progress = computed(() => initState.value?.progress || {})
const progressPct = computed(() => {
  const { done, total } = progress.value
  return total > 0 ? Math.round((done / total) * 100) : 0
})

// 后端状态 → 向导步骤
const step = computed(() => {
  const s = initState.value?.status || 'idle'
  if (['idle', 'failed'].includes(s)) {
    if (s === 'failed' && (initState.value?.blueprint)) return lastStepBeforeFail() || 'config'
    return 'config'
  }
  if (s === 'blueprint') return 'working'
  if (s === 'samples_pending') return (initState.value?.sampleAssets?.length || 0) > 0 ? 'samples' : 'blueprint'
  if (s === 'batch_pending') return 'batch'
  if (s === 'batching') return 'batch'
  if (s === 'layout_pending') return 'layout'
  if (s === 'confirm') return 'confirm'
  if (s === 'applying') return 'confirm'
  if (s === 'done') return 'done'
  return 'config'
})

const stepIndex = computed(() => {
  const order = { config: 0, blueprint: 1, samples: 2, batch: 3, layout: 4, confirm: 5, done: 6, working: -1 }
  return order[step.value] ?? -1
})

function lastStepBeforeFail() {
  // 失败后回到出错前的可重试步骤
  if (!initState.value?.blueprint) return 'config'
  if ((initState.value?.sampleAssets?.length || 0) === 0) return 'blueprint'
  if (initState.value?.hasDraft) return 'confirm'
  if ((initState.value?.sampleAssets?.length || 0) > 0) return 'batch'
  return 'blueprint'
}

const stepHint = computed(() => {
  const idx = stepIndex.value
  if (idx >= 0 && idx < STEP_LIST.length) return `第 ${idx + 1} 步，共 7 步`
  return ''
})

const workingText = computed(() => {
  const s = initState.value?.status
  if (s === 'blueprint') return '正在解读世界观，规划素材与居民…'
  if (s === 'layout_pending' || busy.value) return '正在规划小镇布局…'
  return 'AI 正在思考…'
})

let pollTimer = null

function startPolling() {
  stopPolling()
  pollTimer = setInterval(async () => {
    try {
      await town.fetchInitState()
      const s = initState.value?.status
      if (s === 'confirm' && !town.draftPreview) {
        await town.refreshDraftPreview()
      }
    } catch { /* 网络抖动忽略 */ }
  }, 2000)
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}

async function guard(fn) {
  if (busy.value) return
  busy.value = true
  try {
    await fn()
  } catch (err) {
    console.warn('[wizard]', err?.message)
    town.fetchInitState().catch(() => {})
  } finally {
    busy.value = false
    town.fetchInitState().catch(() => {})
  }
}

function start() {
  guard(async () => {
    await api.startTownInit({
      worldSettingId: form.worldSettingId,
      npcCount: form.npcCount,
      mapCols: form.mapCols,
      mapRows: form.mapRows,
    })
    await town.fetchInitState()
  })
}

function syncBpForm() {
  const bp = initState.value?.blueprint
  if (!bp) return
  bpForm.styleTags = bp.styleTags || ''
  bpForm.groundAssets = [...(bp.groundAssets || [])]
  bpForm.roadAssets = [...(bp.roadAssets || [])]
  bpForm.buildings = [...(bp.buildings || [])]
  bpForm.props = [...(bp.props || [])]
  bpForm.npcs = [...(bp.npcs || [])]
}

function saveBlueprint() {
  guard(async () => {
    await api.updateTownBlueprint({
      styleTags: bpForm.styleTags,
      groundAssets: bpForm.groundAssets,
      roadAssets: bpForm.roadAssets,
      buildings: bpForm.buildings,
      props: bpForm.props,
      npcs: bpForm.npcs,
    })
  })
}

function genSamples() {
  guard(async () => {
    await api.updateTownBlueprint({
      styleTags: bpForm.styleTags,
      groundAssets: bpForm.groundAssets,
      roadAssets: bpForm.roadAssets,
      buildings: bpForm.buildings,
      props: bpForm.props,
      npcs: bpForm.npcs,
    })
    await api.generateTownSamples()
  })
}

function regenSamples() {
  guard(async () => {
    await api.updateTownBlueprint({ styleTags: bpForm.styleTags })
    await api.generateTownSamples()
  })
}

function startBatch() {
  guard(async () => { await api.startTownBatch() })
}

function genLayout() {
  guard(async () => { await api.generateTownLayout() })
}

function reroll() {
  guard(async () => {
    await api.rerollTownLayout()
    await town.refreshDraftPreview()
  })
}

function confirmInit() {
  guard(async () => {
    await api.confirmTownInit()
    await town.fetchInitState()
  })
}

function finish() {
  emit('applied')
  emit('close')
}

function tryClose() {
  // 批量生成/LLM 进行中不给随手关：其余步骤允许退出（任务继续在后台）
  emit('close')
}

// 蓝图到位/更新后同步进编辑表单
watch(() => initState.value?.blueprint, (bp) => {
  if (bp) syncBpForm()
})

onMounted(async () => {
  try {
    const worlds = await api.getWorldSettings()
    const list = (worlds.worlds || worlds.settings || worlds || [])
      .filter(w => w && w.id != null)
      .map(w => ({ label: w.name, value: w.id }))
    worldOptions.value = [{ label: '（跟随当前激活世界观）', value: null }, ...list]
  } catch { /* 列表拉不到就用默认项 */ }

  await town.fetchInitState().catch(() => {})
  syncBpForm()
  startPolling()
})

onBeforeUnmount(stopPolling)
</script>

<style scoped>
.wiz-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 950;
  display: flex;
  align-items: center;
  justify-content: center;
}

.wiz-panel {
  width: 560px;
  max-width: calc(100vw - 32px);
  max-height: min(82vh, 720px);
  background: #f4f1eeed;
  border-radius: 18px;
  box-shadow: 0 20px 60px rgba(54, 42, 38, 0.2);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.wiz-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 16px 18px 8px;
}

.wiz-title { font-size: 16px; font-weight: 700; color: var(--text-bright); }
.wiz-step-hint { flex: 1; font-size: 11px; color: var(--text-secondary); }

.wiz-steps {
  display: flex;
  gap: 4px;
  padding: 4px 18px 10px;
  flex-wrap: wrap;
}

.wiz-step {
  font-size: 10px;
  color: var(--text-secondary);
  background: rgba(240, 236, 232, 0.9);
  border-radius: 999px;
  padding: 2px 8px;
}

.wiz-step.is-active {
  background: rgba(224, 123, 108, 0.14);
  color: var(--accent-hover);
  font-weight: 700;
}

.wiz-step.is-done { opacity: 0.55; }

.wiz-body {
  flex: 1;
  overflow-y: auto;
  padding: 4px 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.wiz-desc { font-size: 13px; color: var(--text-secondary); line-height: 1.7; margin: 0; }

.wiz-field { display: flex; flex-direction: column; gap: 6px; }
.wiz-label { font-size: 12px; color: var(--text-primary); }
.wiz-inline { display: flex; align-items: center; gap: 8px; }
.wiz-inline > * { flex: 1; }
.wiz-x { color: var(--text-secondary); }

.wiz-section { display: flex; flex-direction: column; gap: 6px; }
.wiz-section-title { font-size: 12px; font-weight: 700; color: var(--text-primary); }

.wiz-item {
  display: flex;
  align-items: center;
  gap: 8px;
  background: #fbf8f3;
  border-radius: 10px;
  padding: 7px 10px;
}

.wiz-item-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.wiz-item-name { font-size: 12px; font-weight: 700; color: var(--text-bright); }
.wiz-item-desc {
  font-size: 11px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wiz-item-op {
  cursor: pointer;
  color: var(--text-secondary);
  font-size: 12px;
  padding: 2px 4px;
  border-radius: 6px;
}

.wiz-item-op:hover { color: #c0564a; background: rgba(192, 86, 74, 0.08); }

.wiz-samples { display: flex; gap: 10px; }

.wiz-sample {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  background: #fbf8f3;
  border-radius: 12px;
  padding: 10px;
}

.wiz-sample img {
  width: 100%;
  aspect-ratio: 1;
  object-fit: cover;
  border-radius: 8px;
  image-rendering: pixelated;
}

.wiz-sample span { font-size: 11px; color: var(--text-secondary); }

.wiz-progress { display: flex; align-items: center; gap: 10px; }
.wiz-progress-bar {
  flex: 1;
  height: 10px;
  background: rgba(240, 236, 232, 0.95);
  border-radius: 999px;
  overflow: hidden;
}
.wiz-progress-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 999px;
  transition: width 0.4s ease;
}
.wiz-progress-text { font-size: 12px; color: var(--text-secondary); min-width: 52px; text-align: right; }

.wiz-current { font-size: 12px; color: var(--text-primary); }

.wiz-warnings { display: flex; flex-direction: column; gap: 4px; }
.wiz-warning { font-size: 11px; color: #a07428; }

.wiz-error {
  font-size: 12px;
  color: #c0564a;
  background: rgba(192, 86, 74, 0.08);
  border-radius: 10px;
  padding: 8px 12px;
}

.wiz-actions { display: flex; gap: 10px; justify-content: flex-end; }
.wiz-go { align-self: flex-end; }

.wiz-working {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-secondary);
}

.wiz-working-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
  animation: wiz-pulse 1.2s ease-in-out infinite;
}

@keyframes wiz-pulse {
  0%, 100% { opacity: 0.3; transform: scale(0.8); }
  50% { opacity: 1; transform: scale(1.15); }
}

/* 布局确认：底部紧凑条 */
.wiz-confirm {
  position: fixed;
  bottom: 18px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 950;
  background: #f4f1eeed;
  border-radius: 16px;
  box-shadow: 0 16px 48px rgba(54, 42, 38, 0.22);
  padding: 12px 16px;
  max-width: calc(100vw - 32px);
}

.wiz-confirm-body { display: flex; flex-direction: column; gap: 10px; }
.wiz-step-tag { font-size: 12px; font-weight: 700; color: var(--text-bright); }
.wiz-confirm-actions { display: flex; gap: 10px; }
</style>
