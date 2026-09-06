<template>
  <Teleport to="body">
    <!-- 布局确认阶段：底部紧凑条，把画面让给预览 -->
    <div v-if="localStep === 'layoutConfirm'" class="wiz-confirm">
      <div class="wiz-confirm-body">
        <div class="wiz-step-tag">🏗️ 布图已生成 · 背后就是实时预览</div>
        <div class="wiz-confirm-actions">
          <linshe-button variant="primary" :loading="busy" @click="confirmInit">确认开镇</linshe-button>
          <linshe-button variant="secondary" :loading="busy" @click="reroll">重掷布局</linshe-button>
          <linshe-button variant="ghost" @click="tryClose">再看看</linshe-button>
        </div>
      </div>
    </div>

    <div v-else class="wiz-mask" @click.self="tryClose">
      <div class="wiz-panel" role="dialog" aria-label="小镇初始化向导">
        <div class="wiz-head">
          <span class="wiz-title">小镇初始化</span>
          <span class="wiz-step-hint">{{ stepHint }}</span>
          <linshe-button variant="icon" size="sm" aria-label="关闭" @click="tryClose">✕</linshe-button>
        </div>

        <!-- 步骤条 -->
        <div class="wiz-steps">
          <div
            v-for="(s, i) in STEP_LIST" :key="s.id"
            class="wiz-step" :class="{ 'is-active': localStep === s.id, 'is-done': stepIndex > i }"
            role="button" tabindex="0"
            @click="canJump(s.id) && (localStep = s.id)"
          >
            <span class="wiz-step-dot">{{ stepIndex > i ? '✓' : i + 1 }}</span>
            {{ s.label }}
          </div>
        </div>

        <div class="wiz-body">
          <Transition name="wiz-slide" mode="out-in">
            <!-- ── 1. 配置 ── -->
            <div v-if="localStep === 'config'" key="config">
              <p class="wiz-desc">选一套世界观，AI 会据此生成像素素材、规划小镇布局、安排一批居民。</p>
              <div class="wiz-field">
                <span class="wiz-label">世界观</span>
                <linshe-select v-model="form.worldSettingId" :options="worldOptions" size="md" />
              </div>
              <div class="wiz-field">
                <span class="wiz-label">居民数量（后续还能调整）</span>
                <div class="wiz-slider-row">
                  <input v-model.number="form.npcCount" class="wiz-slider" type="range" min="3" max="16" step="1" :style="{ '--fill': ((form.npcCount - 3) / 13 * 100) + '%' }">
                  <span class="wiz-slider-num">{{ form.npcCount }} 人</span>
                </div>
              </div>
              <div class="wiz-field">
                <span class="wiz-label">地图规格</span>
                <div class="wiz-inline">
                  <linshe-input v-model.number="form.mapCols" size="md" type="number" min="30" max="80" />
                  <span class="wiz-x">×</span>
                  <linshe-input v-model.number="form.mapRows" size="md" type="number" min="30" max="80" />
                </div>
              </div>
              <div class="wiz-error" v-if="initState?.error && localStep === 'config'">{{ initState.error }}</div>
              <linshe-button variant="primary" class="wiz-go" :loading="busy" @click="start">生成蓝图</linshe-button>
            </div>

            <!-- ── 2/3. 素材步（地皮 / 建筑+道具 共用模板） ── -->
            <div v-else-if="localStep === 'tiles' || localStep === 'buildings'" :key="localStep" class="wiz-split">
            <TownPromptPanel
    v-model="stepParams[localStep]"
    :step="localStep"
    :style-tags="bpForm.styleTags"
  />
              <div class="wiz-right">
              <p class="wiz-desc">
                {{ localStep === 'tiles'
                  ? '第一步：地皮资源。修改风格基调或单项描述后逐张生成，全部满意再进入下一步。'
                  : '第二步：建筑与道具。通用建筑会多实例复用，特殊建筑是世界观专属地标。' }}
              </p>

              <!-- 全局风格总输入框 -->
              <div class="wiz-global-style">
                <span class="wiz-label">🎨 全局风格基调（影响本步所有素材）</span>
                <linshe-input v-model="bpForm.styleTags" size="sm" placeholder="warm pastel fantasy village, soft colors" />
              </div>

              <div v-for="(group, gi) in stepGroups" :key="gi" class="wiz-section">
                <div class="wiz-section-title">
                  {{ group.label }}
                  <span class="wiz-section-count">{{ groupReady(group) }}/{{ group.items.length }} 就绪</span>
                </div>
                <TransitionGroup name="wiz-pop" tag="div" class="wiz-asset-grid">
                  <div
                    v-for="(item, i) in group.items" :key="item.uid"
                    class="wiz-asset-card"
                    :class="{ 'is-ready': assetOf(item)?.status === 'ready', 'is-busy': item.busy }"
                    :style="{ animationDelay: (i * 60) + 'ms' }"
                  >
                    <div class="wiz-asset-thumb">
                      <img
                        v-if="assetOf(item)?.status === 'ready'"
                        :src="assetUrl(assetOf(item))"
                        class="wiz-asset-img"
                        alt=""
                      >
                      <span v-else-if="item.busy" class="wiz-asset-state is-spin">⏳</span>
                      <span v-else-if="assetOf(item)?.status === 'failed'" class="wiz-asset-state">⚠️</span>
                      <span v-else class="wiz-asset-state">·</span>
                    </div>
                    <div class="wiz-asset-info">
                      <div class="wiz-asset-name">
                        {{ item.name }}
                        <span v-if="item.badge" class="wiz-badge" :class="'is-' + item.badge">{{ item.badgeText }}</span>
                      </div>
                      <linshe-input v-model="item.desc" size="sm" class="wiz-asset-desc" placeholder="生成描述…" />
                    </div>
                    <div class="wiz-asset-ops">
                      <linshe-button
                        variant="secondary" size="sm"
                        :loading="item.busy"
                        @click="genAssetItem(item)"
                      >{{ assetOf(item)?.status === 'ready' ? '重生成' : '生成' }}</linshe-button>
                    </div>
                  </div>
                </TransitionGroup>
              </div>

              <div class="wiz-progress" v-if="stepBusyCount > 0">
                <div class="wiz-progress-bar"><div class="wiz-progress-fill is-shimmer" :style="{ width: stepReadyPct + '%' }"></div></div>
                <span class="wiz-progress-text">{{ stepReadyCount }} / {{ stepTotal }}</span>
              </div>
              <div class="wiz-error" v-if="stepError">{{ stepError }}</div>

              <div class="wiz-actions">
                <linshe-button variant="secondary" :loading="stepGenerating" @click="generateAllStep">一键生成全部（{{ stepTotal }} 张）</linshe-button>
                <linshe-button variant="primary" :disabled="stepReadyCount < stepTotal" @click="nextFromAssetStep">
                  {{ stepReadyCount < stepTotal ? `还差 ${stepTotal - stepReadyCount} 张` : '确认，下一步 →' }}
                </linshe-button>
              </div>
              </div>
            </div>

            <!-- ── 4. 居民 ── -->
            <div v-else-if="localStep === 'npcs'" key="npcs" class="wiz-split">
            <TownPromptPanel
    v-model="stepParams[localStep]"
    :step="localStep"
    :style-tags="bpForm.styleTags"
  />
              <div class="wiz-right">
              <p class="wiz-desc">第三步：招募居民。按世界观生成稳定的人格卡，素材满意后确认。</p>

              <div class="wiz-field">
                <span class="wiz-label">居民数量</span>
                <div class="wiz-slider-row">
                  <input v-model.number="npcSlider" class="wiz-slider" type="range" min="3" max="16" step="1" :style="{ '--fill': ((npcSlider - 3) / 13 * 100) + '%' }">
                  <span class="wiz-slider-num">{{ npcSlider }} 人</span>
                </div>
              </div>
              <linshe-button
                variant="secondary" size="sm"
                :loading="rosterBusy"
                :disabled="npcSlider === (bpForm.npcs.length || 0)"
                @click="regenRoster"
              >按 {{ npcSlider }} 人重新生成名单</linshe-button>

              <TransitionGroup name="wiz-pop" tag="div" class="wiz-npc-grid">
                <div
                  v-for="(n, i) in bpForm.npcs" :key="n.uid || n.displayName"
                  class="wiz-npc-card"
                  :style="{ animationDelay: (i * 50) + 'ms' }"
                >
                  <div class="wiz-npc-portrait">
                    <img v-if="npcAssetOf(n, 'portrait')" :src="npcAssetOf(n, 'portrait')" alt="">
                    <span v-else-if="n.genBusy" class="wiz-asset-state is-spin">⏳</span>
                    <span v-else class="wiz-asset-state">🧍</span>
                  </div>
                  <div class="wiz-npc-form">
                    <div class="wiz-npc-line">
                      <linshe-input v-model="n.displayName" size="sm" class="is-name" placeholder="名字" />
                      <linshe-input v-model="n.job" size="sm" class="is-job" placeholder="职业" />
                    </div>
                    <linshe-input v-model="n.persona" type="textarea" :rows="2" size="sm" placeholder="人设" />
                    <div class="wiz-npc-sprites">
                      <div
                        v-for="dir in ['down', 'up']" :key="dir"
                        class="wiz-npc-sprite" role="button" tabindex="0"
                        :title="`编辑${dir === 'down' ? '正面' : '背面'}小人`"
                        @click="openEditor(n, dir)"
                      >
                        <img v-if="npcAssetOf(n, dir)" :src="npcAssetOf(n, dir)" alt="">
                        <span v-else>·</span>
                      </div>
                      <div
                        v-if="npcAssetOf(n, 'portrait')"
                        class="wiz-npc-sprite is-portrait" role="button" tabindex="0"
                        title="编辑立绘"
                        @click="openEditor(n, 'portrait')"
                      >
                        <img :src="npcAssetOf(n, 'portrait')" alt="">
                      </div>
                    </div>
                  </div>
                  <linshe-button
                    variant="ghost" size="sm"
                    :loading="n.genBusy"
                    @click.stop="genNpcAssets(n)"
                  >{{ npcAssetOf(n, 'portrait') ? '重生成素材' : '生成素材' }}</linshe-button>
                </div>
              </TransitionGroup>

              <div class="wiz-actions is-column">
                <linshe-button variant="secondary" :loading="commitBusy" @click="commitNpcs">
                  {{ bpForm.npcs.every(n => npcAssetOf(n, 'portrait')) ? '已建档 · 同步我的修改' : '1️⃣ 创建人格卡（写入居民表，不入角色表）' }}
                </linshe-button>
                <linshe-button
                  variant="primary"
                  :loading="assetsBusy"
                  :disabled="committedIds.length === 0"
                  @click="genAllNpcAssets"
                >2️⃣ 一键生成全员素材（立绘 + 正/背小人）</linshe-button>
                <linshe-button
                  variant="primary"
                  :disabled="!allNpcReady"
                  @click="localStep = 'player'"
                >{{ allNpcReady ? '3️⃣ 确认居民，确认「我」的形象 →' : `素材齐了才能继续（${npcReadyCount}/${bpForm.npcs.length}）` }}</linshe-button>
              </div>
              </div>
            </div>

            <!-- ── 5. 布图 ── -->
            <div v-else-if="localStep === 'layout'" key="layout">
              <p class="wiz-desc">素材齐了。AI 将根据素材清单规划整张小镇布局（道路/建筑/地点/居民落位）。</p>
              <div class="wiz-error" v-if="initState?.error">{{ initState.error }}</div>
              <div class="wiz-actions">
                <linshe-button variant="primary" :loading="busy" @click="genLayout">生成布局</linshe-button>
              </div>
            </div>

            <!-- ── 6. 「我」的确认 + 开镇 ── -->
            <div v-else-if="localStep === 'player'" key="player" class="wiz-split">
            <TownPromptPanel
    v-model="stepParams[localStep]"
    :step="localStep"
    :style-tags="bpForm.styleTags"
  />
              <div class="wiz-right">
              <p class="wiz-desc">开镇前最后一步：确认「我」的形象。生成后可以拖动检查、点击抠白、脚底贴底。</p>
              <div class="wiz-player-kit">
                <div class="wiz-player-portrait">
                  <TownImageEditor
                    v-if="playerKit.portrait"
                    :src="playerKit.portrait"
                    :asset-id="playerKit.portraitId"
                    fit-height="320"
                    hint="立绘：点击白色继续抠白"
                  />
                  <div v-else class="wiz-player-empty">
                    <linshe-button variant="secondary" :loading="playerBusy" @click="genPlayerKit">生成「我」的立绘（900×1600）</linshe-button>
                  </div>
                </div>
                <div class="wiz-player-sprites">
                  <div v-if="playerKit.down" class="wiz-player-sprite">
                    <TownImageEditor :src="playerKit.down" :asset-id="playerKit.downId" fit-height="180" hint="正面小人：确认脚底贴底" />
                  </div>
                  <div v-if="playerKit.up" class="wiz-player-sprite">
                    <TownImageEditor :src="playerKit.up" :asset-id="playerKit.upId" fit-height="180" hint="背面小人" />
                  </div>
                  <linshe-button v-if="!playerKit.down" variant="secondary" :loading="playerBusy" @click="genPlayerKit">
                    生成「我」的像素小人（正/背）
                  </linshe-button>
                  <linshe-button v-else variant="ghost" size="sm" :loading="playerBusy" @click="genPlayerKit">重新生成整套</linshe-button>
                </div>
              </div>
              <div class="wiz-actions">
                <linshe-button variant="secondary" @click="localStep = 'layout'">← 去规划布局</linshe-button>
                <linshe-button variant="primary" :loading="busy" @click="confirmInit">形象没问题，开镇！</linshe-button>
              </div>
              </div>
            </div>

            <!-- 进行中（蓝图/布图 LLM 调用） -->
            <div v-else-if="localStep === 'working'" key="working">
              <p class="wiz-desc">{{ workingText }}</p>
              <div class="wiz-working">
                <span class="wiz-working-dot"></span>
                AI 正在思考，大约需要十几秒…
              </div>
            </div>

            <!-- 完成 -->
            <div v-else-if="localStep === 'done'" key="done">
              <p class="wiz-desc">🎉 小镇已经开张！居民们正在按作息生活。</p>
              <linshe-button variant="primary" class="wiz-go" @click="finish">进入小镇</linshe-button>
            </div>
          </Transition>
        </div>
      </div>
    </div>

    <!-- 图片编辑弹窗 -->
    <Teleport to="body">
      <Transition name="wiz-fade">
        <div v-if="editor.open" class="wiz-editor-mask" @click.self="editor.open = false">
          <div class="wiz-editor-panel" role="dialog" :aria-label="editor.title">
            <div class="wiz-editor-head">
              <span class="wiz-editor-title">{{ editor.title }}</span>
              <linshe-button variant="icon" size="sm" aria-label="关闭" @click="editor.open = false">✕</linshe-button>
            </div>
            <TownImageEditor
              v-if="editor.open"
              :src="editor.src"
              :asset-id="editor.assetId"
              :fit-height="editor.portrait ? 380 : 200"
              :hint="editor.portrait ? '立绘：点击白色继续抠白 · 拖动检查脚底' : '小人：点击白色继续抠白 · 确认脚底贴底'"
              @saved="onEditorSaved"
            />
          </div>
        </div>
      </Transition>
    </Teleport>
  </Teleport>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import * as api from '../../api/index.js'
import { useTownStore } from '../../stores/town.js'
import LinsheButton from '../ui/LinsheButton.vue'
import LinsheInput from '../ui/LinsheInput.vue'
import LinsheSelect from '../ui/LinsheSelect.vue'
import TownImageEditor from './TownImageEditor.vue'
import TownPromptPanel from './TownPromptPanel.vue'

const emit = defineEmits(['close', 'applied'])

const town = useTownStore()
const busy = ref(false)
const worldOptions = ref([{ label: '（跟随当前激活世界观）', value: null }])

const form = reactive({ worldSettingId: null, npcCount: 8, mapCols: 50, mapRows: 50 })
const bpForm = reactive({ styleTags: '', groundAssets: [], roadAssets: [], buildings: [], props: [], npcs: [] })
const localStep = ref('config')
const npcSlider = ref(8)
const rosterBusy = ref(false)
const commitBusy = ref(false)
const assetsBusy = ref(false)
const playerBusy = ref(false)
const playerKit = reactive({ portrait: null, portraitId: null, down: null, downId: null, up: null, upId: null })
const editor = reactive({ open: false, src: '', assetId: null, title: '', portrait: false, npc: null })
// 每步生成的提示词硬逻辑前缀 + LoRA（空 prefix = 用后端默认）
const stepParams = reactive({
  tiles: { prefix: '', loras: [] },
  buildings: { prefix: 'pixel art, game sprite', loras: [] },
  npcs: { prefix: 'pixel art, game sprite, mini human sized, full body', loras: [] },
  player: { prefix: 'pixel art, game sprite, mini human sized, full body', loras: [] },
})
const loraFiles = ref([])
const assets = ref([])

const STEP_LIST = [
  { id: 'config', label: '配置' },
  { id: 'tiles', label: '地皮' },
  { id: 'buildings', label: '建筑' },
  { id: 'npcs', label: '居民' },
  { id: 'layout', label: '布图' },
  { id: 'player', label: '我' },
]

const initState = computed(() => town.initState)
const committedIds = computed(() => initState.value?.npcIds || [])
const allNpcReady = computed(() => bpForm.npcs.length > 0 && bpForm.npcs.every(n => npcAssetOf(n, 'portrait')))
const npcReadyCount = computed(() => bpForm.npcs.filter(n => npcAssetOf(n, 'portrait')).length)

// ── 素材步通用 ──

let uidSeq = 1
function attachUid(list) {
  for (const item of list) if (!item.uid) item.uid = `u${uidSeq++}`
}

/** 当前步骤的分组（地皮：地砖+道路；建筑：建筑+道具） */
const stepGroups = computed(() => {
  if (localStep.value === 'tiles') {
    return [
      { label: '地砖', kind: 'ground', items: bpForm.groundAssets },
      { label: '道路', kind: 'road', items: bpForm.roadAssets },
    ]
  }
  if (localStep.value === 'buildings') {
    return [
      { label: '通用建筑（可复用）', kind: 'building', items: bpForm.buildings.filter(b => !b.special) },
      { label: '特殊建筑（世界观地标）', kind: 'building', items: bpForm.buildings.filter(b => b.special) },
      { label: '道具', kind: 'prop', items: bpForm.props },
    ]
  }
  return []
})

const stepItems = computed(() => stepGroups.value.flatMap(g => g.items))
const stepTotal = computed(() => stepItems.value.length)
const stepReadyCount = computed(() => stepItems.value.filter(item => assetOf(item)?.status === 'ready').length)
const stepBusyCount = computed(() => stepItems.value.filter(item => item.busy).length)
const stepReadyPct = computed(() => stepTotal.value ? Math.round((stepReadyCount.value / stepTotal.value) * 100) : 0)
const stepGenerating = computed(() => stepBusyCount.value > 0)
const stepError = ref('')

function groupReady(group) {
  return group.items.filter(item => assetOf(item)?.status === 'ready').length
}

/** 蓝图项 → 素材（匹配 base key 或 _01 变体前缀，取第一张就绪的） */
function assetOf(item) {
  return assets.value.find(a => a.key === item.key && a.status === 'ready')
    || assets.value.find(a => (a.key === item.key || a.key.startsWith(item.key + '_')) && a.status === 'ready')
}

function assetUrl(a) {
  return `${a.image_path}?v=${a.meta?.updatedAt ?? 0}`
}

function npcAssetOf(n, what) {
  // 全部从建档 NPC DTO 取（initState.wizardNpcs），key 按 displayName 对齐蓝图卡
  const dto = initState.value?.wizardNpcs?.find(w => w.displayName === n.displayName)
  if (!dto) return null
  if (what === 'portrait') {
    const a = dto.portrait
    return a?.status === 'ready' ? `${a.image_path}?v=${a.meta?.updatedAt ?? 0}` : null
  }
  const a = dto.sprites?.[what]
  return a?.status === 'ready' ? `${a.image_path}?v=${a.meta?.updatedAt ?? 0}` : null
}

// ── 步骤控制 ──

const stepIndex = computed(() => STEP_LIST.findIndex(s => s.id === localStep.value))
const stepHint = computed(() => {
  const idx = STEP_LIST.findIndex(s => s.id === localStep.value)
  return idx >= 0 ? `第 ${idx + 1} 步，共 ${STEP_LIST.length + 1} 步` : ''
})
const workingText = computed(() => {
  const s = initState.value?.status
  if (s === 'blueprint') return '正在解读世界观，规划素材与居民…'
  return 'AI 正在思考…'
})

function canJump(id) {
  // 已走过的步骤可回跳
  return stepIndex.value > STEP_LIST.findIndex(s => s.id === id)
}

let lastBpJson = ''
function syncBpForm(force = false) {
  const bp = initState.value?.blueprint
  if (!bp) return
  const json = JSON.stringify(bp)
  if (!force && json === lastBpJson) return // 轮询拿到相同内容时不动表单（保住编辑中状态与 uid）
  lastBpJson = json
  bpForm.styleTags = bp.styleTags || ''
  const sections = [
    ['groundAssets', bp.groundAssets], ['roadAssets', bp.roadAssets],
    ['buildings', bp.buildings], ['props', bp.props], ['npcs', bp.npcs],
  ]
  for (const [key, incoming] of sections) {
    const cur = bpForm[key]
    bpForm[key] = (incoming || []).map(item => {
      // 按 key / displayName 原地合并：保留用户编辑中的 desc、busy、uid
      const match = item.key
        ? cur.find(c => c.key === item.key)
        : cur.find(c => c.displayName === item.displayName)
      if (match) {
        return Object.assign(match, item, { desc: match.desc ?? item.desc, uid: match.uid })
      }
      return { ...item }
    })
    attachUid(bpForm[key])
  }
  if (localStep.value === 'config') localStep.value = 'tiles'
  refreshAssets()
}

async function refreshAssets() {
  try {
    const data = await api.fetchTownAssets()
    assets.value = data.assets || []
  } catch (err) {
    console.warn('[wizard] assets fetch failed:', err?.message)
  }
}

// ── 动作 ──

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
    syncBpForm()
  })
}

async function saveBlueprint() {
  await api.updateTownBlueprint({
    styleTags: bpForm.styleTags,
    groundAssets: bpForm.groundAssets,
    roadAssets: bpForm.roadAssets,
    buildings: bpForm.buildings,
    props: bpForm.props,
    npcs: bpForm.npcs,
  })
}

async function genAssetItem(item) {
  const isTiles = localStep.value === 'tiles'
  const kind = isTiles
    ? (bpForm.groundAssets.some(g => g.uid === item.uid) ? 'ground' : 'road')
    : (bpForm.buildings.some(b => b.uid === item.uid) ? 'building' : 'prop')
  item.busy = true
  stepError.value = ''
  try {
    await saveBlueprint()
    const variants = Math.max(1, Math.min(3, item.variants || 1))
    for (let v = 1; v <= variants; v++) {
      const suffix = variants > 1 ? String(v).padStart(2, '0') : ''
      const key = suffix ? `${item.key}_${suffix}` : item.key
      const name = suffix ? `${item.name} ${suffix}` : item.name
      const existing = assets.value.find(a => a.key === key)
      if (existing?.status === 'ready') continue
      if (existing) {
        await api.regenerateTownAsset(existing.id, { desc: item.desc, styleTags: bpForm.styleTags })
      } else {
        await api.createTownAsset({
          kind,
          key,
          name,
          desc: item.desc,
          meta: {
            desc: item.desc,
            styleTags: bpForm.styleTags,
            footprint: kind === 'building' ? item.footprint : undefined,
            special: kind === 'building' ? !!item.special : undefined,
            reusable: kind === 'building' ? !!item.reusable : undefined,
            maxInstances: kind === 'building' ? item.maxInstances : undefined,
            blocking: kind === 'prop' ? item.blocking : undefined,
          },
        })
      }
      await refreshAssets()
    }
  } catch (err) {
    stepError.value = `「${item.name}」生成失败：${err?.message || err}`
  } finally {
    item.busy = false
  }
}

async function generateAllStep() {
  await saveBlueprint()
  for (const item of stepItems.value) {
    if (assetOf(item)?.status !== 'ready') {
      await genAssetItem(item) // 串行：不抢 ComfyUI
    }
  }
}

function nextFromAssetStep() {
  localStep.value = localStep.value === 'tiles' ? 'buildings' : 'npcs'
}

// ── 居民步 ──

async function regenRoster() {
  rosterBusy.value = true
  try {
    await saveBlueprint()
    await api.regenerateTownNpcRoster(npcSlider.value)
    await town.fetchInitState()
    syncBpForm()
    npcSlider.value = bpForm.npcs.length || npcSlider.value
  } catch (err) {
    console.warn('[wizard] roster regen failed:', err?.message)
  } finally {
    rosterBusy.value = false
  }
}

async function commitNpcs() {
  commitBusy.value = true
  try {
    await saveBlueprint()
    await api.commitTownWizardNpcs()
    await town.fetchInitState()
  } catch (err) {
    console.warn('[wizard] commit npcs failed:', err?.message)
  } finally {
    commitBusy.value = false
  }
}

async function genNpcAssets(n) {
  n.genBusy = true
  try {
    await saveBlueprint()
    await api.commitTownWizardNpcs()
    const npcId = (initState.value?.npcIds || [])[bpForm.npcs.indexOf(n)]
    if (!npcId) throw new Error('人格卡未建档')
    const params = { promptPrefix: stepParams.npcs.prefix, loras: stepParams.npcs.loras }
    await api.generateTownNpcSprites(npcId, params)
    await api.generateTownNpcPortrait(npcId, params)
    await town.fetchInitState()
    await refreshAssets()
  } catch (err) {
    console.warn('[wizard] npc assets failed:', err?.message)
  } finally {
    n.genBusy = false
  }
}

async function genAllNpcAssets() {
  assetsBusy.value = true
  try {
    await saveBlueprint()
    await api.commitTownWizardNpcs()
    const ids = initState.value?.npcIds || []
    for (let i = 0; i < ids.length; i++) {
      const n = bpForm.npcs[i]
      if (n) n.genBusy = true
      const params = { promptPrefix: stepParams.npcs.prefix, loras: stepParams.npcs.loras }
      try {
        await api.generateTownNpcSprites(ids[i], params)
        await api.generateTownNpcPortrait(ids[i], params)
      } catch (err) {
        console.warn('[wizard] npc assets failed:', err?.message)
      }
      if (n) n.genBusy = false
      await town.fetchInitState()
      await refreshAssets()
    }
  } finally {
    assetsBusy.value = false
  }
}

function openEditor(n, what) {
  const src = npcAssetOf(n, what === 'portrait' ? 'portrait' : what)
  if (!src) return
  const dto = initState.value?.wizardNpcs?.find(w => w.displayName === n.displayName)
  const assetId = what === 'portrait' ? dto?.portrait?.id : dto?.sprites?.[what]?.id
  if (!assetId) return
  editor.open = true
  editor.src = src
  editor.assetId = assetId
  editor.title = `${n.displayName} · ${what === 'portrait' ? '立绘' : what === 'down' ? '正面小人' : '背面小人'}`
  editor.portrait = what === 'portrait'
  editor.npc = n
}

function onEditorSaved() {
  // 保存后刷新素材与 DTO
  refreshAssets()
  town.fetchInitState().catch(() => {})
}

// ── 布图 / 玩家 / 开镇 ──

function genLayout() {
  guard(async () => {
    await api.generateTownLayout()
    await town.fetchInitState()
    if (initState.value?.status === 'confirm') {
      await town.refreshDraftPreview()
      localStep.value = 'layoutConfirm'
    }
  })
}

function reroll() {
  guard(async () => {
    await api.rerollTownLayout()
    await town.refreshDraftPreview()
  })
}

async function genPlayerKit() {
  playerBusy.value = true
  try {
    const data = await api.regenerateTownPlayerKit({ promptPrefix: stepParams.player.prefix, loras: stepParams.player.loras })
    applyPlayerKit(data.kit)
  } catch (err) {
    console.warn('[wizard] player kit failed:', err?.message)
  } finally {
    playerBusy.value = false
  }
}

function applyPlayerKit(kit) {
  if (!kit) return
  playerKit.down = kit.sprites?.down?.status === 'ready' ? assetUrl(kit.sprites.down) : null
  playerKit.downId = kit.sprites?.down?.id ?? null
  playerKit.up = kit.sprites?.up?.status === 'ready' ? assetUrl(kit.sprites.up) : null
  playerKit.upId = kit.sprites?.up?.id ?? null
  playerKit.portrait = kit.portrait?.status === 'ready' ? assetUrl(kit.portrait) : null
  playerKit.portraitId = kit.portrait?.id ?? null
}

function confirmInit() {
  guard(async () => {
    await api.confirmTownInit()
    await town.fetchInitState()
    localStep.value = 'done'
  })
}

function finish() {
  emit('applied')
  emit('close')
}

function tryClose() {
  emit('close')
}

async function loadPlayerKitIfAny() {
  try {
    const kit = await api.fetchTownPlayerKit()
    if (kit.sprites?.down || kit.portrait) applyPlayerKit(kit)
  } catch { /* ignore */ }
}

let pollTimer = null
function startPolling() {
  stopPolling()
  pollTimer = setInterval(async () => {
    try {
      await town.fetchInitState()
    } catch { /* 网络抖动忽略 */ }
  }, 2500)
}
function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}

// 蓝图到位后同步表单
watch(() => initState.value?.blueprint, (bp) => { if (bp) syncBpForm() })
watch(localStep, (v) => {
  if (v === 'player' && !playerKit.portrait && !playerKit.down && !playerBusy.value) genPlayerKit()
})

watch(() => initState.value?.status, (s) => {
  if (s === 'confirm' && localStep.value === 'layout') {
    town.refreshDraftPreview().then(() => { localStep.value = 'layoutConfirm' }).catch(() => {})
  }
})

onMounted(async () => {
  try {
    const worlds = await api.getWorldSettings()
    const list = (worlds.list || worlds.worlds || worlds || [])
      .filter(w => w && w.id != null)
      .map(w => ({ label: w.name, value: w.id }))
    worldOptions.value = [{ label: '（跟随当前激活世界观）', value: null }, ...list]
  } catch { /* 列表拉不到就用默认项 */ }
  try {
    const lf = await api.fetchLorasFiles()
    loraFiles.value = (lf.files || []).map(f => typeof f === 'string' ? { path: f, label: f.split(/[\/]/).pop() } : { path: f.path || f.name || '', label: (f.path || f.name || '').split(/[\/]/).pop() })
  } catch { /* LoRA 列表拉不到就不启用 */ }

  await town.fetchInitState().catch(() => {})
  const s = initState.value?.status
  // 断点续跑：从已完成程度恢复到对应步骤
  if (s === 'blueprint') localStep.value = 'working'
  else syncBpForm()
  if (s === 'layout_pending') localStep.value = 'layout'
  if (s === 'confirm') {
    await town.refreshDraftPreview().catch(() => {})
    localStep.value = 'layoutConfirm'
  }
  if (s === 'done') localStep.value = 'done'
  if ((initState.value?.npcIds || []).length > 0) localStep.value = 'npcs'
  else if (s === 'batch_pending' || s === 'layout_pending') {
    // 旧流程素材已生成 → 恢复到居民步
    localStep.value = 'npcs'
  }
  startPolling()
  loadPlayerKitIfAny()
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
  width: 620px;
  max-width: calc(100vw - 32px);
  max-height: min(88vh, 820px);
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
  gap: 6px;
  padding: 4px 18px 12px;
  flex-wrap: wrap;
}

.wiz-step {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--text-secondary);
  background: rgba(240, 236, 232, 0.9);
  border-radius: 999px;
  padding: 3px 10px;
  cursor: default;
  transition: all 0.25s ease;
}

.wiz-step-dot {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.08);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 9px;
}

.wiz-step.is-active {
  background: rgba(224, 123, 108, 0.16);
  color: var(--accent-hover);
  font-weight: 700;
  transform: scale(1.04);
}

.wiz-step.is-active .wiz-step-dot { background: var(--accent); color: #fff; }
.wiz-step.is-done { opacity: 0.7; cursor: pointer; }
.wiz-step.is-done:hover { background: rgba(224, 123, 108, 0.1); }
.wiz-step.is-done .wiz-step-dot { background: rgba(124, 176, 116, 0.5); color: #fff; }

.wiz-body {
  flex: 1;
  overflow-y: auto;
  padding: 4px 18px 20px;
}

.wiz-desc { font-size: 13px; color: var(--text-secondary); line-height: 1.7; margin: 0 0 12px; }

.wiz-split {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.wiz-right {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.wiz-field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
.wiz-label { font-size: 12px; color: var(--text-primary); }
.wiz-inline { display: flex; align-items: center; gap: 8px; }
.wiz-inline > * { flex: 1; }
.wiz-x { color: var(--text-secondary); }

/* 拉条 */
.wiz-slider-row { display: flex; align-items: center; gap: 12px; }
.wiz-slider {
  flex: 1;
  -webkit-appearance: none;
  appearance: none;
  height: 8px;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--accent) var(--fill, 40%), rgba(240, 236, 232, 0.95) var(--fill, 40%));
  outline: none;
  cursor: pointer;
}
.wiz-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: #fff;
  border: 3px solid var(--accent);
  box-shadow: 0 2px 8px rgba(54, 42, 38, 0.25);
  cursor: grab;
  transition: transform 0.15s ease;
}
.wiz-slider::-webkit-slider-thumb:hover { transform: scale(1.12); }
.wiz-slider-num {
  font-size: 13px;
  font-weight: 700;
  color: var(--accent-hover);
  min-width: 42px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/* 全局风格输入 */
.wiz-global-style {
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: rgba(224, 123, 108, 0.06);
  border: 1px dashed rgba(224, 123, 108, 0.35);
  border-radius: 12px;
  padding: 10px 12px;
  margin-bottom: 14px;
}

.wiz-section { margin-bottom: 14px; }
.wiz-section-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-primary);
  display: flex;
  justify-content: space-between;
  margin-bottom: 8px;
}
.wiz-section-count { color: var(--text-secondary); font-weight: 400; }

.wiz-asset-grid { display: flex; flex-direction: column; gap: 8px; }

.wiz-asset-card {
  display: flex;
  align-items: center;
  gap: 10px;
  background: #fbf8f3;
  border-radius: 12px;
  padding: 8px 10px;
  animation: wiz-pop-in 0.35s cubic-bezier(0.34, 1.4, 0.64, 1) backwards;
  transition: box-shadow 0.2s ease;
}

.wiz-asset-card.is-ready { box-shadow: inset 0 0 0 1.5px rgba(124, 176, 116, 0.35); }

@keyframes wiz-pop-in {
  from { opacity: 0; transform: translateY(8px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}

.wiz-asset-thumb {
  width: 56px;
  height: 56px;
  border-radius: 10px;
  background: #f1ebe1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  flex-shrink: 0;
}

.wiz-asset-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  image-rendering: pixelated;
  animation: wiz-img-in 0.4s cubic-bezier(0.34, 1.4, 0.64, 1);
}

@keyframes wiz-img-in {
  from { opacity: 0; transform: scale(0.6) rotate(-4deg); }
  to { opacity: 1; transform: scale(1) rotate(0); }
}

.wiz-asset-state { font-size: 18px; color: #cfc4b4; }
.wiz-asset-state.is-spin { animation: wiz-spin 1s linear infinite; display: inline-block; }
@keyframes wiz-spin { to { transform: rotate(360deg); } }

.wiz-asset-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.wiz-asset-name { font-size: 12px; font-weight: 700; color: var(--text-bright); display: flex; align-items: center; gap: 6px; }

.wiz-badge {
  font-size: 9px;
  font-weight: 400;
  padding: 1px 7px;
  border-radius: 999px;
}
.wiz-badge.is-特殊 { background: rgba(224, 123, 108, 0.14); color: var(--accent-hover); }
.wiz-badge.is-通用 { background: rgba(124, 176, 116, 0.16); color: #5c8a52; }
.wiz-badge.is-可阻挡 { background: rgba(140, 130, 190, 0.14); color: #6a5f9e; }

.wiz-asset-ops { flex-shrink: 0; }

.wiz-progress { display: flex; align-items: center; gap: 10px; margin: 10px 0; }
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
  transition: width 0.5s ease;
}
.wiz-progress-fill.is-shimmer {
  background-image: linear-gradient(110deg, var(--accent) 30%, #eda094 45%, var(--accent) 60%);
  background-size: 200% 100%;
  animation: wiz-shimmer 1.6s linear infinite;
}
@keyframes wiz-shimmer { to { background-position: -200% 0; } }
.wiz-progress-text { font-size: 12px; color: var(--text-secondary); min-width: 52px; text-align: right; }

.wiz-error {
  font-size: 12px;
  color: #c0564a;
  background: rgba(192, 86, 74, 0.08);
  border-radius: 10px;
  padding: 8px 12px;
  margin: 10px 0;
}

.wiz-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 12px; }
.wiz-actions.is-column { flex-direction: column; align-items: stretch; }
.wiz-go { align-self: flex-end; margin-top: 8px; }

/* 居民卡 */
.wiz-npc-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }

.wiz-npc-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: #fbf8f3;
  border-radius: 14px;
  padding: 10px;
  animation: wiz-pop-in 0.35s cubic-bezier(0.34, 1.4, 0.64, 1) backwards;
}

.wiz-npc-portrait {
  width: 100%;
  height: 150px;
  border-radius: 10px;
  background: #efe9de;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  overflow: hidden;
}

.wiz-npc-portrait img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  object-position: bottom;
  animation: wiz-img-in 0.4s cubic-bezier(0.34, 1.4, 0.64, 1);
}

.wiz-npc-form { display: flex; flex-direction: column; gap: 6px; }
.wiz-npc-line { display: flex; gap: 6px; }
.wiz-npc-line .is-name { flex: 1; }
.wiz-npc-line .is-job { width: 80px; }

.wiz-npc-sprites { display: flex; gap: 6px; align-items: flex-end; }

.wiz-npc-sprite {
  width: 40px;
  height: 52px;
  border-radius: 8px;
  background: #f1ebe1;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  overflow: hidden;
  cursor: pointer;
  border: 1.5px solid transparent;
  transition: border-color 0.15s ease;
}

.wiz-npc-sprite:hover { border-color: var(--accent); }
.wiz-npc-sprite img { width: 100%; height: 100%; object-fit: contain; object-position: bottom; image-rendering: pixelated; }
.wiz-npc-sprite.is-portrait img { image-rendering: auto; }
.wiz-npc-sprite span { color: #cfc4b4; font-size: 14px; padding-bottom: 6px; }

.wiz-player-kit {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.wiz-player-portrait { min-height: 200px; }
.wiz-player-empty {
  height: 100%;
  min-height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #fbf8f3;
  border-radius: 12px;
}
.wiz-player-sprites { display: flex; flex-direction: column; gap: 10px; }

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

/* 步骤切换动画 */
.wiz-slide-enter-active { transition: opacity 0.3s ease, transform 0.3s cubic-bezier(0.34, 1.3, 0.64, 1); }
.wiz-slide-leave-active { transition: opacity 0.18s ease, transform 0.18s ease; }
.wiz-slide-enter-from { opacity: 0; transform: translateX(24px); }
.wiz-slide-leave-to { opacity: 0; transform: translateX(-16px); }

/* 列表 pop 动画 */
.wiz-pop-enter-active { transition: opacity 0.3s ease, transform 0.3s cubic-bezier(0.34, 1.4, 0.64, 1); }
.wiz-pop-leave-active { transition: opacity 0.15s ease; position: absolute; }
.wiz-pop-enter-from { opacity: 0; transform: scale(0.9); }
.wiz-pop-leave-to { opacity: 0; }

.wiz-fade-enter-active, .wiz-fade-leave-active { transition: opacity 0.25s ease; }
.wiz-fade-enter-from, .wiz-fade-leave-to { opacity: 0; }

/* 图片编辑弹窗 */
.wiz-editor-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
}

.wiz-editor-panel {
  width: min(560px, calc(100vw - 40px));
  max-height: min(88vh, 780px);
  overflow-y: auto;
  background: #f4f1eeed;
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(54, 42, 38, 0.25);
  padding: 14px;
}

.wiz-editor-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.wiz-editor-title { font-size: 14px; font-weight: 700; color: var(--text-bright); }

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
  animation: wiz-rise 0.35s cubic-bezier(0.34, 1.4, 0.64, 1);
}

@keyframes wiz-rise {
  from { opacity: 0; transform: translate(-50%, 16px); }
  to { opacity: 1; transform: translate(-50%, 0); }
}

.wiz-confirm-body { display: flex; flex-direction: column; gap: 10px; }
.wiz-step-tag { font-size: 12px; font-weight: 700; color: var(--text-bright); }
.wiz-confirm-actions { display: flex; gap: 10px; }
</style>
