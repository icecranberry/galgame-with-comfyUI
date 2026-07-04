<template>
  <div class="schedule-view">
    <div class="sched-layout">
      <!-- ═══ 左：主体内容区 ═══ -->
      <div class="sched-main">
        <!-- 已加载且有角色 -->
        <template v-if="!store.loading && enrichedChars.length > 0">
          <div class="main-topbar" :class="{ 'header-hidden': isMobile && !headerVisible }">
            <div class="topbar-row">
              <h2 @click="isMobile && toggleMobileSidebar?.()" :class="{ 'is-clickable': isMobile }">日程</h2>
              <div class="topbar-actions">
                <input
                  v-model="searchQuery"
                  class="search-input"
                  placeholder="搜索..."
                  @keydown.esc="searchQuery = ''"
                />
                <button
                  class="btn-reset"
                  @click.stop="showResetConfirm = true"
                  :disabled="resetTask?.processing"
                >
                  <svg v-if="!resetTask?.processing" class="btn-reset-icon" viewBox="0 0 1024 1024" width="16" height="16"><path d="M1017.6 595.2c19.2-134.4-6.4-256-89.6-364.8C832 89.6 588.8-19.2 480 25.6c6.4 25.6 6.4 44.8 12.8 70.4 262.4 0 428.8 185.6 448 371.2 19.2 179.2-89.6 371.2-249.6 428.8v-179.2c0-25.6-12.8-38.4-32-38.4-38.4 0-51.2 12.8-38.4 57.6 12.8 70.4 6.4 140.8 0 211.2 0 38.4 19.2 32 64 32h160c83.2 0 96 12.8 96-32 0-25.6-6.4-38.4-38.4-38.4H832c96-76.8 166.4-179.2 185.6-313.6zM76.8 512c0-153.6 115.2-345.6 224-364.8v153.6c0 32 6.4 38.4 38.4 38.4s38.4-6.4 38.4-38.4V64c0-32-6.4-38.4-38.4-38.4H102.4C70.4 25.6 64 32 64 64s0 38.4 38.4 38.4h102.4c-230.4 185.6-243.2 467.2-128 659.2 108.8 185.6 326.4 256 460.8 236.8-6.4-25.6-6.4-44.8-12.8-70.4-275.2 6.4-448-217.6-448-416z"/></svg>
                  <span>{{ resetTask?.processing ? '重置中...' : '全部重置' }}</span>
                </button>
              </div>
            </div>
          </div>

          <div class="card-grid" @scroll.passive="onScroll" ref="cardGridEl">
            <CharacterStatusCard
              v-for="c in filteredChars"
              :key="c.id"
              :char="c"
              @select="onSelectChar(c.id)"
              @peek="onCardPeek(c.id)"
            />
          </div>
        </template>

        <!-- 加载态 -->
        <div v-else-if="store.loading" class="sched-placeholder">
          <div class="loader"></div>
          <p>加载角色日程中...</p>
        </div>

        <!-- 空态 -->
        <div v-else class="sched-placeholder">
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" opacity="0.2"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          <p>今天还没有角色日程</p>
          <span class="ph-hint">生成日程后，这里会显示每位角色的今日动向。</span>
          <button class="btn-glass" @click="regenerateAll">为所有角色生成日程</button>
        </div>
      </div>

      <!-- ═══ 扫描特效遮罩（仅生成时显示）═══ -->
      <aside v-if="sidebarScanActive" class="sched-sidebar is-scanning">
        <div class="sidebar-scan-overlay">
          <div class="sidebar-scan-line"></div>
          <div class="sidebar-scan-glow"></div>
          <div class="sidebar-scan-content">
            <div class="sidebar-scan-icon">
              <svg viewBox="0 0 80 80" class="sidebar-scan-ring">
                <circle cx="40" cy="40" r="34" fill="none" stroke="rgba(224,123,108,0.12)" stroke-width="2.5"/>
                <circle cx="40" cy="40" r="34" fill="none" stroke="var(--accent)"
                  stroke-width="2.5" stroke-linecap="round"
                  stroke-dasharray="214"
                  :stroke-dashoffset="214 * (1 - sidebarScanProgress / 100)"
                  class="sidebar-scan-ring-fill"
                />
              </svg>
              <div class="sidebar-scan-pct">{{ sidebarScanProgress }}%</div>
            </div>
            <div class="sidebar-scan-label">日程生成中</div>
            <div class="sidebar-scan-phrase">
              <Transition name="phrase" mode="out-in">
                <p :key="currentSidebarTipIndex">{{ sidebarTips[currentSidebarTipIndex] }}</p>
              </Transition>
            </div>
            <div class="sidebar-scan-sub">
              <template v-if="sidebarScanContext === 'reset' && resetTask">
                正在为 <b>{{ resetTask.currentName || '...' }}</b> 编排日程
                <span class="sidebar-scan-count">({{ resetTask.current }}/{{ resetTask.total }})</span>
              </template>
              <template v-else-if="sidebarScanContext === 'single'">
                正在为 <b>{{ detailChar?.display_name || '...' }}</b> 重新编排日程
              </template>
              <template v-else>
                <template v-if="store.characters.length > 0">
                  正在检索 {{ store.characters.length }} 个角色的今日行程...
                </template>
                <template v-else>
                  正在等待日程数据抵达...
                </template>
              </template>
            </div>
          </div>
        </div>
      </aside>
    </div>
  </div>

    <!-- ═══ 角色详情抽屉 ═══ -->
    <CharacterDetailDrawer
      :open="drawerOpen"
      :char="detailChar"
      :activities="detailActs"
      :loading="detailLoading"
      :peek-busy="peekBusy"
      :regenerating="detailRegenerating"
      @close="drawerOpen = false"
      @peek="onPeek"
      @regenerate="onRegenerate"
      @chat="onChat"
    />

    <!-- ═══ 瞄一眼快照弹窗（胶卷边框风格） ═══ -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="peekOpen" class="peek-overlay" @click="onPeekClose">
          <div class="peek-film" :class="{ 'pk-shutter-fire': shutterFire }" :style="peekFilmStyle" @click.stop>
            <!-- 胶卷上黑边 + 白色矩形齿孔 -->
            <div class="pk-film-edge pk-film-edge-top" aria-hidden="true"></div>

            <!-- 图片区域（尺寸以奇遇参数为基准） -->
            <div class="pk-body" :style="peekBodyStyle">
              <template v-if="peekLoading">
                <div class="pk-wait">
                  <div class="pk-ring-container">
                    <svg viewBox="0 0 80 80" class="pk-ring">
                      <circle cx="40" cy="40" r="34" fill="none" stroke="rgba(0,0,0,0.06)" stroke-width="3" />
                      <circle cx="40" cy="40" r="34" fill="none" stroke="var(--accent)"
                        stroke-width="3" stroke-linecap="round"
                        :stroke-dasharray="2 * Math.PI * 34"
                        :stroke-dashoffset="2 * Math.PI * 34 * (1 - peekProgress / 100)"
                        class="pk-ring-progress"
                      />
                    </svg>
                    <div class="pk-ring-pct">{{ peekProgress }}%</div>
                  </div>
                  <div class="pk-wait-phrase">
                    <Transition name="phrase" mode="out-in">
                      <p :key="currentPhraseIndex">{{ phrases[currentPhraseIndex] }}</p>
                    </Transition>
                  </div>
                </div>
              </template>
              <template v-else-if="peekError">
                <div class="pk-err"><p>生成失败</p><span>{{ peekError }}</span><button class="btn-glass" @click="retryPeek">重试</button></div>
              </template>
              <div v-else-if="peekImage" class="pk-shutter-stage">
                <div class="pk-shutter-flash"></div>
                <div class="pk-shutter-curtain pk-curtain-top"></div>
                <div class="pk-shutter-curtain pk-curtain-bottom"></div>
                <img
                  :src="peekImage"
                  class="pk-img"
                  @click="lightboxVisible = true"
                />
              </div>
            </div>

            <!-- 胶卷下黑边 + 白色矩形齿孔 -->
            <div class="pk-film-edge pk-film-edge-bottom" aria-hidden="true"></div>

            <!-- 底部信息栏（原 pk-top + footer 合并） -->
            <div class="pk-bar">
              <div class="pk-char">
                <div
                  class="pk-char-avatar"
                  :style="peekChar?.avatar_path ? { backgroundImage: `url(${peekChar.avatar_path})`, backgroundSize:'cover', backgroundPosition:'center' } : { background: '#e07b6c' }"
                ><span v-if="!peekChar?.avatar_path" class="pk-char-avatar-text">{{ peekChar?.display_name?.charAt(0) || '' }}</span></div>
                <div><b>{{ peekAct?.activity || '瞄一眼' }}</b><span v-if="peekAct?.location">{{ peekAct.location }}</span></div>
              </div>
              <div class="pk-actions">
                <button v-if="peekImage && !peekLoading" class="pk-retake-btn" :disabled="peekBusy" @click="retakePeek">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="23,4 23,10 17,10" />
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                  </svg>
                  <span class="pk-retake-label">{{ peekBusy ? '拍摄中...' : '再拍一张' }}</span>
                </button>
                <button class="pk-x" @click="onPeekClose">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 图片放大预览 -->
    <Teleport to="body">
      <VueEasyLightbox
        :visible="lightboxVisible"
        :imgs="peekImage ? [peekImage] : []"
        :z-index="1200"
        :max-zoom="6"
        :min-zoom="0.3"
        :zoom-scale="0.35"
        @hide="lightboxVisible = false"
      />
    </Teleport>

    <!-- 瞄一眼图片悬浮 description 提示框 -->
    <Teleport to="body">
      <Transition name="lbtip">
        <div
          v-if="peekOpen && peekTooltipVisible && lightboxDescription"
          class="lightbox-tooltip"
          :class="{ flip: peekTooltipFlip }"
          :style="peekTooltipStyle"
        >
          {{ lightboxDescription }}
        </div>
      </Transition>
    </Teleport>

    <!-- ═══ 重置世界线确认弹窗 ═══ -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="showResetConfirm" class="reset-overlay" @click.self="showResetConfirm = false">
          <div class="reset-dialog" @click.stop>
            <div class="reset-dialog-header">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="1,4 1,10 7,10" />
                <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
              </svg>
              <span>全部重置</span>
            </div>
            <p class="reset-dialog-desc">
              将重新生成全部 <b>{{ store.characters.length }}</b> 个角色的日程表。<br/>
              此操作会逐一生成，需要一些时间。
            </p>
            <div class="reset-dialog-actions">
              <button class="reset-btn-cancel" @click="showResetConfirm = false">取消</button>
              <button class="reset-btn-confirm" @click="confirmResetAll">确认重置</button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- ═══ 重置世界线进度弹窗 ═══ -->
    <Teleport to="body">
      <Transition name="modal">
        <div v-if="resetTask" class="reset-overlay">
          <div class="reset-dialog reset-progress-dialog" @click.stop>
            <div class="reset-dialog-header">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" :stroke="resetTask.phase === 'complete' ? '#52c41a' : 'var(--accent)'" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="1,4 1,10 7,10" />
                <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
              </svg>
              <span>{{ resetTask.phase === 'complete' ? '重置完成' : resetTask.phase === 'cancelled' ? '已取消' : '重置世界线中...' }}</span>
            </div>

            <!-- 进度条 -->
            <div class="reset-progress-bar-wrap">
              <div class="reset-progress-bar">
                <div
                  class="reset-progress-fill"
                  :style="{ width: resetProgressPct + '%' }"
                  :class="{ done: resetTask.phase === 'complete', cancelled: resetTask.phase === 'cancelled' }"
                ></div>
              </div>
              <span class="reset-progress-text">{{ resetTask.current }} / {{ resetTask.total }}</span>
            </div>

            <!-- 当前任务 -->
            <div class="reset-current-task" v-if="resetTask.phase === 'running'">
              <div class="loader-ring-sm"></div>
              <span>正在生成 <b>{{ resetTask.currentName }}</b> 的日程...</span>
            </div>
            <div class="reset-current-task done" v-else-if="resetTask.phase === 'complete'">
              <span>✅ 全部 {{ resetTask.total }} 个角色日程已更新</span>
            </div>
            <div class="reset-current-task cancelled" v-else-if="resetTask.phase === 'cancelled'">
              <span>⚠️ 已取消，完成了 {{ resetTask.current }} / {{ resetTask.total }} 个角色</span>
            </div>

            <!-- 错误列表 -->
            <div v-if="resetTask.errors.length > 0" class="reset-errors">
              <div v-for="(e, i) in resetTask.errors" :key="i" class="reset-error-item">
                <span class="reset-error-name">{{ e.name }}</span>
                <span class="reset-error-msg">{{ e.error }}</span>
              </div>
            </div>

            <!-- 操作按钮 -->
            <div class="reset-dialog-actions">
              <template v-if="resetTask.phase === 'running'">
                <button class="reset-btn-cancel" @click="cancelReset">取消重置</button>
                <button class="reset-btn-bg" @click="dismissResetProgress">后台静默生成</button>
              </template>
              <template v-else>
                <button class="reset-btn-confirm" @click="finishReset">完成</button>
              </template>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, inject, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useScheduleStore } from '../stores/schedule.js'
import { useSettingsStore } from '../stores/settings.js'
import { onEvent } from '../stores/unifiedStream.js'
import * as api from '../api/index.js'
import CharacterStatusCard from '../components/CharacterStatusCard.vue'
import CharacterDetailDrawer from '../components/CharacterDetailDrawer.vue'
import VueEasyLightbox from 'vue-easy-lightbox'
import 'vue-easy-lightbox/dist/external-css/vue-easy-lightbox.css'

const store = useScheduleStore()
const settingsStore = useSettingsStore()
const router = useRouter()

const isMobile = inject('isMobile')
const toggleMobileSidebar = inject('toggleMobileSidebar')

// ── 时钟 ──
// ── 筛选 ──
const activeFilter = ref('all')
const searchQuery = ref('')

// ── 移动端滚动隐藏顶栏 ──
const headerVisible = ref(true)
let lastScrollTop = 0
const cardGridEl = ref<HTMLElement | null>(null)

function onScroll() {
  const el = cardGridEl.value
  if (!el) return

  if (isMobile) {
    const delta = el.scrollTop - lastScrollTop
    if (el.scrollTop > 60 && delta > 8) {
      headerVisible.value = false
    } else if (delta < -4) {
      headerVisible.value = true
    }
    lastScrollTop = el.scrollTop
  }
}

const filterPills = [
  { key: 'all',     label: '全部' },
  { key: 'awake',   label: '醒着' },
  { key: 'sleeping',label: '梦乡中' },
]

// ── 数据增强：解析 current_activity → _location + _behavior ──
const enrichedChars = computed(() => {
  return [...store.characters]
    .sort((a, b) => (a.display_name || '').localeCompare(b.display_name || '', 'zh-CN'))
    .map(c => {
    const raw = c.current_activity || ''
    const sep = raw.indexOf(' · ')
    const location = sep > -1 ? raw.slice(0, sep) : raw
    const behavior = sep > -1 ? raw.slice(sep + 3) : raw
    const noSchedule = raw === '未设置日程'
    return {
      ...c,
      _location: noSchedule ? '未知地点' : (location || '未知地点'),
      _behavior: noSchedule ? '自由行动' : (behavior || '暂无信息'),
      _description: c._desc || (!noSchedule ? behavior : '') || (!noSchedule ? raw : '') || (noSchedule ? '没有日程，自由行动中...' : ''),
      _hasEvent: false,
      _nextActivity: null,
    }
  })
})

const filteredChars = computed(() => {
  let list = enrichedChars.value
  const q = searchQuery.value.trim().toLowerCase()
  if (q) list = list.filter(c => c.display_name?.toLowerCase().includes(q))
  if (activeFilter.value === 'awake') return list.filter(c => !c.is_sleeping)
  if (activeFilter.value === 'sleeping') return list.filter(c => c.is_sleeping)
  return list
})

// ── 选中角色 / 抽屉 ──
const drawerOpen = ref(false)
const selectedCharId = ref<number | null>(null)
const detailChar = computed(() => {
  if (!selectedCharId.value) return null
  return enrichedChars.value.find(x => x.id === selectedCharId.value) || null
})
const detailActs = ref<any[]>([])
const detailLoading = ref(false)
const detailRegenerating = ref(false)

// ── 快照 ──
const peekOpen = ref(false)
const peekBusy = ref(false)
const peekLoading = ref(false)
const peekImage = ref<string | null>(null)
const peekError = ref<string | null>(null)
const peekPrompt = ref<string | null>(null)
const peekChar = ref<any>(null)
const peekAct = ref<any>(null)
const shutterFire = ref(false) // 相机快门动画触发器
const lightboxVisible = ref(false)
const peekTooltipVisible = ref(false)
const peekTooltipX = ref(0)
const peekTooltipY = ref(0)
const peekTooltipFlip = ref(false)

const peekTooltipStyle = computed(() => {
  if (!peekTooltipVisible.value) return { display: 'none' }
  const base = { top: peekTooltipY.value + 'px' }
  if (peekTooltipFlip.value) {
    return { ...base, left: 'auto', right: (window.innerWidth - peekTooltipX.value) + 'px' }
  }
  return { ...base, left: peekTooltipX.value + 'px', right: 'auto' }
})

const lightboxDescription = computed(() => {
  return peekAct.value?.description || ''
})

// ── 重置世界线 ──
interface ResetTask {
  phase: 'running' | 'complete' | 'cancelled'
  current: number
  total: number
  currentName: string
  errors: { name: string; error: string }[]
  processing: boolean
}

const showResetConfirm = ref(false)
const resetTask = ref<ResetTask | null>(null)
const resetProgressPct = computed(() => {
  if (!resetTask.value || resetTask.value.total === 0) return 0
  return Math.round((resetTask.value.current / resetTask.value.total) * 100)
})

// ── 侧边栏：扫描态控制 ──
const sidebarScanActive = computed(() =>
  store.loading || detailRegenerating.value || (resetTask.value?.phase === 'running')
)
const sidebarScanContext = computed(() => {
  if (resetTask.value?.phase === 'running') return 'reset'
  if (detailRegenerating.value) return 'single'
  return 'load'
})

// 脉冲进度（加载/单角色再生用 interval 驱动）
const _pulseProgress = ref(0)
let _pulseTimer: ReturnType<typeof setInterval> | null = null
const sidebarScanProgress = computed(() => {
  if (resetTask.value?.phase === 'running') return resetProgressPct.value
  return _pulseProgress.value
})

watch(sidebarScanActive, (active) => {
  if (active && resetTask.value?.phase !== 'running') {
    _pulseProgress.value = 0
    _pulseTimer = setInterval(() => {
      _pulseProgress.value = (_pulseProgress.value + 1) % 96
    }, 180)
  } else {
    if (_pulseTimer) { clearInterval(_pulseTimer); _pulseTimer = null }
    _pulseProgress.value = 0
  }
})

// ── 侧边栏过渡文字轮播 ──
const sidebarTips = [
  '正在翻阅日程档案……',
  '正在校准时间轴偏差……',
  '正在推算角色行动轨迹……',
  '正在调取天气与季节数据……',
  '正在匹配角色性格与行为……',
  '正在绘制今日活动热力图……',
  '正在协调角色间互动冲突……',
  '正在查询世界观事件簿……',
  '正在排列优先级队列……',
  '正在注入随机扰动因子……',
  '正在校对昼夜节律周期……',
  '正在解析角色当日心情……',
  '正在交叉验证时间线一致性……',
  '正在向命运女神投币……',
  '正在整理待办事项清单……',
]
const currentSidebarTipIndex = ref(0)
let _sidebarTipTimer: ReturnType<typeof setInterval> | null = null

function startSidebarTips() {
  currentSidebarTipIndex.value = 0
  let idx = 0
  _sidebarTipTimer = setInterval(() => {
    idx = (idx + 1) % sidebarTips.length
    currentSidebarTipIndex.value = idx
  }, 2200)
}

function stopSidebarTips() {
  if (_sidebarTipTimer) { clearInterval(_sidebarTipTimer); _sidebarTipTimer = null }
}

watch(sidebarScanActive, (active) => {
  if (active) startSidebarTips()
  else stopSidebarTips()
}, { immediate: true })

// ── 加载文案轮播（瞄一眼弹窗用）──
const phrases = [
  '正在寻找拍摄角度……',
  '正在抓取表情……',
  '正在选择机位……',
  '正在寻找人在哪……',
  '正在翻找相机镜头……',
  '正在调整光圈参数……',
  '正在构图对焦……',
  '正在等待最佳光线……',
]
const currentPhraseIndex = ref(0)
let _phraseTimer: ReturnType<typeof setInterval> | null = null

watch(peekLoading, (loading) => {
  if (loading) {
    currentPhraseIndex.value = 0
    _phraseTimer = setInterval(() => {
      currentPhraseIndex.value = (currentPhraseIndex.value + 1) % phrases.length
    }, 3000)
  } else {
    if (_phraseTimer) { clearInterval(_phraseTimer); _phraseTimer = null }
  }
})

// ── 相机快门动画：图片到达时触发 ──
watch(peekImage, (newVal) => {
  if (newVal) {
    // 先复位再触发，确保每次图片到达都播放动画
    shutterFire.value = false
    nextTick(() => {
      requestAnimationFrame(() => {
        shutterFire.value = true
      })
    })
  } else {
    shutterFire.value = false
  }
})

// ── 进度条：模拟虚拟→ComfyUI真实接管（参照 ImageGenBubble 逻辑）──
const realPct = ref(0)       // ComfyUI 真实进度 0~100
const simulatedPct = ref(0)  // 虚拟进度 0~100
const peekProgress = computed(() => {
  if (peekImage.value) return 100 // 已有图片 = 100%
  return Math.max(Math.floor(simulatedPct.value), realPct.value)
})
let _progressTimer: ReturnType<typeof setTimeout> | null = null
let _maxedOut = false

function scheduleTick() {
  _progressTimer = setTimeout(() => {
    if (peekImage.value) { simulatedPct.value = 100; return } // 已有结果
    if (peekError.value) return
    // 真实进度已超过模拟 → 模拟暂停，等真实追上
    if (realPct.value > simulatedPct.value) { scheduleTick(); return }
    if (_maxedOut) { scheduleTick(); return }
    const inc = 1 + Math.random() * 3
    simulatedPct.value = Math.min(95, simulatedPct.value + inc)
    if (simulatedPct.value >= 95) _maxedOut = true
    scheduleTick()
  }, 400 + Math.random() * 1200)
}

function startFakeProgress() {
  stopFakeProgress()
  simulatedPct.value = 0
  realPct.value = 0
  _maxedOut = false
  scheduleTick()
}

function stopFakeProgress() {
  if (_progressTimer) { clearTimeout(_progressTimer); _progressTimer = null }
}

// ── 瞄一眼弹窗尺寸：以奇遇参数 aspect-ratio 为准，比例始终贴合，不超视口 ──
const peekBodyStyle = computed(() => {
  const ew = settingsStore.eventWidth || 1600
  const eh = settingsStore.eventHeight || 1200
  const ratio = ew / eh
  // 胶卷边 (20×2) + 底部栏 (~44) + overlay padding (20×2) ≈ 124
  const chromeH = 124
  const chromeW = 40 + 8 // overlay padding + film margin
  const vw = window.innerWidth
  const vh = window.innerHeight
  const mobile = vw < 768
  // 手机端宽度占满，桌面端留 8-12% 呼吸空间
  const availW = mobile ? vw - chromeW : vw * 0.88 - chromeW
  const availH = mobile ? vh * 0.92 - chromeH : vh * 0.88 - chromeH
  // 选更紧的约束，保证弹窗完整可见且比例不变
  let bodyW, bodyH
  if (availW / ratio <= availH) {
    bodyW = availW
    bodyH = bodyW / ratio
  } else {
    bodyH = availH
    bodyW = bodyH * ratio
  }
  return { width: `${Math.round(bodyW)}px`, height: `${Math.round(bodyH)}px` }
})

// ── 胶卷外壳与 pk-body 同宽，防止 pk-bar 文字撑开容器 ──
const peekFilmStyle = computed(() => {
  return { width: peekBodyStyle.value.width }
})

// ── 生命周期 ──
onMounted(() => {
  store.fetchOverview()
  settingsStore.loadComfyConfig()
  try {
    onEvent('schedule_peek_ready', (d: any) => {
      if (d.prompt) peekPrompt.value = d.prompt
      if (d.images?.length) { peekImage.value = d.images[0]; peekError.value = null }
      else if (d.error) { peekError.value = d.error }
      peekLoading.value = false; peekBusy.value = false
      simulatedPct.value = 100
      stopFakeProgress()
    })
    onEvent('schedule_peek_progress', (d: any) => {
      if (d.progress != null) {
        realPct.value = d.progress
      }
    })
  } catch { /* */ }

  _resetUnlisten = onEvent('schedule_reset_progress', (data: any) => {
    if (!resetTask.value) return

    if (data.phase === 'running') {
      resetTask.value.phase = 'running'
      resetTask.value.current = data.current || 0
      resetTask.value.total = data.total || resetTask.value.total
      resetTask.value.currentName = data.character_name || ''
      resetTask.value.processing = true
      if (data.status === 'error' && data.character_name) {
        resetTask.value.errors.push({ name: data.character_name, error: data.error || '未知错误' })
      }
    } else if (data.phase === 'complete' || data.phase === 'cancelled') {
      resetTask.value.phase = data.phase
      resetTask.value.current = data.current || resetTask.value.current
      resetTask.value.processing = false
      // 静默刷新概览（不触发 loading，避免 card-grid 闪烁）
      store.fetchOverview(true)
    } else if (data.phase === 'error') {
      resetTask.value.phase = 'cancelled'
      resetTask.value.processing = false
    }
  })
})
onUnmounted(() => {
  if (_resetUnlisten) _resetUnlisten()
  if (_phraseTimer) { clearInterval(_phraseTimer); _phraseTimer = null }
  stopSidebarTips()
  if (_pulseTimer) { clearInterval(_pulseTimer); _pulseTimer = null }
})

// ── 方法 ──
function onFilter(key: string) { activeFilter.value = key }

async function onSelectChar(id: number) {
  selectedCharId.value = id
  drawerOpen.value = true
  detailLoading.value = true
  detailActs.value = []
  try {
    const d = await store.fetchCharacterSchedule(id)
    detailActs.value = d.activities || []
  } catch { detailActs.value = [] }
  finally { detailLoading.value = false }
}

function onPeek() {
  if (!detailChar.value) return
  const act = detailActs.value.find((a: any) => a.isCurrent) || detailActs.value[0]
  peekChar.value = detailChar.value
  peekAct.value = act || null
  peekImage.value = null; peekError.value = null; peekPrompt.value = null
  peekOpen.value = true; peekBusy.value = true; peekLoading.value = true
  startFakeProgress()
  store.peekSnapshot(detailChar.value.id)
}

async function onRegenerate() {
  if (!detailChar.value || detailRegenerating.value) return
  detailRegenerating.value = true
  try {
    // regenerateSchedule 内部已静默刷新概览，这里不再重复调用
    try { await store.regenerateSchedule(detailChar.value.id) } catch { return }
    detailLoading.value = true
    try {
      const d = await store.fetchCharacterSchedule(detailChar.value.id)
      detailActs.value = d.activities || []
    } catch { }
    finally { detailLoading.value = false }
  } finally {
    detailRegenerating.value = false
  }
}

async function onCardPeek(id: number) {
  const c = enrichedChars.value.find(x => x.id === id)
  if (!c) return
  selectedCharId.value = id
  detailActs.value = []
  try {
    const d = await store.fetchCharacterSchedule(id)
    detailActs.value = d.activities || []
  } catch { /* */ }
  const act = detailActs.value.find((a: any) => a.isCurrent) || detailActs.value[0]
  peekChar.value = detailChar.value
  peekAct.value = act || null
  peekImage.value = null; peekError.value = null; peekPrompt.value = null
  peekOpen.value = true; peekBusy.value = true; peekLoading.value = true
  startFakeProgress()
  store.peekSnapshot(id)
}

function onChat() {
  if (!detailChar.value) return
  drawerOpen.value = false
  router.push(`/chat/${detailChar.value.id}`)
}

function retryPeek() {
  if (!peekChar.value) return
  peekError.value = null; peekPrompt.value = null; peekLoading.value = true; peekBusy.value = true
  startFakeProgress()
  store.peekSnapshot(peekChar.value.id)
}

async function retakePeek() {
  if (!peekChar.value || !peekPrompt.value) return
  peekImage.value = null; peekError.value = null
  peekLoading.value = true; peekBusy.value = true
  startFakeProgress()
  try {
    await api.retakePeekSnapshot(peekChar.value.id, peekPrompt.value)
  } catch (err: any) {
    peekError.value = err.message
    peekLoading.value = false
    peekBusy.value = false
    stopFakeProgress()
  }
}

function onPeekClose() {
  peekOpen.value = false
  peekPrompt.value = null
  stopFakeProgress()
}

// ── 瞄一眼图片悬浮 description ──
function handlePeekMouseMove(e: MouseEvent) {
  const target = e.target as HTMLElement
  const overBody = target.closest('.pk-body')
  if (overBody) {
    peekTooltipY.value = e.clientY - 12
    // 靠近右边缘时翻转到光标左侧
    if (e.clientX + 18 + 340 > window.innerWidth - 20) {
      peekTooltipX.value = e.clientX - 18
      peekTooltipFlip.value = true
    } else {
      peekTooltipX.value = e.clientX + 18
      peekTooltipFlip.value = false
    }
    peekTooltipVisible.value = true
  } else {
    peekTooltipVisible.value = false
  }
}

watch(peekOpen, (v) => {
  if (v) {
    document.addEventListener('mousemove', handlePeekMouseMove)
  } else {
    document.removeEventListener('mousemove', handlePeekMouseMove)
    peekTooltipVisible.value = false
  }
})

async function regenerateAll() {
  for (const c of store.characters) {
    // regenerateSchedule 内部已静默刷新，这里不额外调 fetchOverview
    try { await store.regenerateSchedule(c.id) } catch { /* continue */ }
  }
}

let _resetUnlisten: (() => void) | null = null

async function confirmResetAll() {
  showResetConfirm.value = false
  resetTask.value = {
    phase: 'running',
    current: 0,
    total: 0,
    currentName: '',
    errors: [],
    processing: true,
  }

  try {
    const result = await api.regenerateAllSchedules()
    resetTask.value.total = result.total || 0
  } catch (err: any) {
    if (err.message?.includes('busy') || err.message?.includes('正在进行中')) {
      alert('重置世界线正在进行中，请等待当前任务完成')
    } else {
      alert('启动重置失败: ' + (err.message || '未知错误'))
    }
    resetTask.value = null
  }
}

async function cancelReset() {
  try {
    await api.cancelRegenerateAll()
    // 状态会通过 SSE 事件更新
  } catch (err) {
    console.error('[ScheduleView] cancel reset failed:', err)
  }
}

function dismissResetProgress() {
  // 后台静默生成：关闭弹窗但不取消任务
  // 重置完成后会自动刷新概览
  resetTask.value = null
}

function finishReset() {
  resetTask.value = null
  // 静默刷新，不触发 loading 闪烁
  store.fetchOverview(true)
}
</script>

<style scoped>
.schedule-view {
  flex: 1; display: flex; flex-direction: column;
  height: 100vh; height: 100dvh; overflow: hidden;
  background: transparent;
}

/* ── Layout: 左主体 + 右侧边栏 ── */
.sched-layout { flex: 1; display: flex; min-height: 0; overflow: hidden; position: relative; }

/* ── 左：主体内容区 ── */
.sched-main { flex: 1; display: flex; flex-direction: column; min-width: 0; overflow: hidden; }

.main-topbar {
  padding: 14px 24px;
  border-bottom: 1px solid var(--glass-border);
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  will-change: transform;
}
.header-hidden { transform: translateY(-100%); }

.topbar-row {
  display: flex; align-items: center; justify-content: space-between;
}
.topbar-row h2 { margin: 0; font-size: 1.1rem; font-weight: 700; color: var(--text-bright); }
.topbar-row h2.is-clickable { cursor: pointer; }

.topbar-actions { display: flex; align-items: center; gap: 10px; }
.search-input {
  width: 140px; padding: 7px 12px;
  border: 1px solid var(--glass-border); border-radius: 10px;
  background: rgba(255,255,255,0.65); color: var(--text-primary);
  font-size: 0.82rem; outline: none; transition: border-color 0.2s;
}
.search-input::placeholder { color: var(--text-secondary); opacity: 0.6; }
.search-input:focus { border-color: var(--accent); }

/* 重置世界线按钮 — 和朋友圈 btn-post 同款 */
.btn-reset {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 22px;
  border-radius: 14px;
  border: 2px solid transparent;
  background: linear-gradient(120deg, #f8edea 0%, #f2eaf4 35%, #eaf0f8 65%, #f8edea 100%);
  background-size: 200% 200%;
  color: var(--accent);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.3s ease;
  white-space: nowrap;
}
.btn-reset-icon { flex-shrink: 0; fill: currentColor; }
.btn-reset:hover:not(:disabled) {
  border: 2px solid rgba(224, 123, 108, 0.55);
  box-shadow: 0 3px 20px rgba(224, 123, 108, 0.10);
  color: #a85545;
  animation: waterflow 1s ease-in-out infinite;
}
@keyframes waterflow {
  0%, 100% { background-position: 0% 50%; }
  50%      { background-position: 100% 50%; }
}
.btn-reset:disabled { opacity: 0.4; cursor: not-allowed; }


/* ── Card Grid ── */
.card-grid {
  flex: 1; overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
  gap: 12px; padding: 16px 20px;
  align-content: start;
}

/* ── Placeholder ── */
.sched-placeholder {
  flex: 1; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 10px;
  color: var(--text-secondary);
}
.sched-placeholder p { margin: 0; font-size: 0.95rem; }
.ph-hint { font-size: 0.8rem; color: #bfbbb6; }

.loader { width: 36px; height: 36px; border: 3px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.7s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.btn-glass {
  display: inline-flex; align-items: center; gap: 5px; margin-top: 6px;
  padding: 8px 18px; border: 1px solid var(--border); border-radius: 999px;
  background: var(--glass-bg); color: var(--text-secondary);
  font-size: 0.85rem; cursor: pointer; transition: 0.15s;
}
.btn-glass:hover { background: var(--bg-hover); color: var(--text-bright); }

/* ═══════════════════════════════════════════
   扫描特效侧边栏（仅生成时显示）
   ═══════════════════════════════════════════ */
.sched-sidebar {
  position: absolute;
  top: 0; right: 0; bottom: 0;
  width: 260px;
  z-index: 10;
  border-left: 1px solid rgba(224,123,108,0.18);
  background: rgba(255, 255, 255, 0.45);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
  display: flex; flex-direction: column;
  overflow: hidden;
  box-shadow: inset 0 0 60px rgba(224,123,108,0.04);
}

.sidebar-scan-overlay {
  position: absolute; inset: 0;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  overflow: hidden;
  z-index: 5;
}

/* ── 扫描线（酒馆同款）── */
.sidebar-scan-line {
  position: absolute;
  left: 12%; right: 12%;
  height: 2px;
  background: linear-gradient(90deg,
    transparent 0%,
    rgba(224,123,108,0.3) 15%,
    var(--accent) 50%,
    rgba(224,123,108,0.3) 85%,
    transparent 100%
  );
  animation: sidebar-scan-sweep 2.6s ease-in-out infinite;
  box-shadow: 0 0 28px rgba(224,123,108,0.55), 0 0 10px rgba(224,123,108,0.25);
  z-index: 2;
  pointer-events: none;
}

@keyframes sidebar-scan-sweep {
  0%   { top: 8%;  opacity: 0.15; }
  18%  { top: 92%; opacity: 1; }
  36%  { top: 92%; opacity: 0.15; }
  54%  { top: 8%;  opacity: 1; }
  72%  { top: 8%;  opacity: 0.15; }
  90%  { top: 92%; opacity: 0.7; }
  100% { top: 8%;  opacity: 0.15; }
}

/* ── 扫描光晕 ── */
.sidebar-scan-glow {
  position: absolute;
  left: 20%; right: 20%;
  height: 60px;
  background: radial-gradient(ellipse at center,
    rgba(224,123,108,0.12) 0%,
    rgba(224,123,108,0.04) 40%,
    transparent 70%
  );
  animation: sidebar-glow-follow 2.6s ease-in-out infinite;
  z-index: 1;
  pointer-events: none;
  filter: blur(8px);
}

@keyframes sidebar-glow-follow {
  0%   { top: 6%;  opacity: 0.2; }
  18%  { top: 70%; opacity: 0.9; }
  36%  { top: 70%; opacity: 0.2; }
  54%  { top: 6%;  opacity: 0.9; }
  72%  { top: 6%;  opacity: 0.2; }
  90%  { top: 70%; opacity: 0.6; }
  100% { top: 6%;  opacity: 0.2; }
}

/* ── 扫描文字内容区 ── */
.sidebar-scan-content {
  position: relative; z-index: 3;
  display: flex; flex-direction: column;
  align-items: center; gap: 10px;
  padding: 24px 20px;
  text-align: center;
}

/* ── 环形进度 ── */
.sidebar-scan-icon {
  position: relative; width: 72px; height: 72px;
  margin-bottom: 4px;
}
.sidebar-scan-ring {
  width: 72px; height: 72px;
  transform: rotate(-90deg);
}
.sidebar-scan-ring-fill {
  transition: stroke-dashoffset 0.5s ease;
}
.sidebar-scan-pct {
  position: absolute; top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  font-size: 17px; font-weight: 700;
  color: var(--accent);
}

/* ── 状态标签 ── */
.sidebar-scan-label {
  font-size: 13px; font-weight: 700;
  color: var(--accent);
  letter-spacing: 0.08em;
  animation: sidebar-label-pulse 1.4s ease-in-out infinite;
}

@keyframes sidebar-label-pulse {
  0%, 100% { opacity: 0.5; }
  50%      { opacity: 1; }
}

/* ── 过渡文字轮播 ── */
.sidebar-scan-phrase {
  position: relative;
  min-height: 22px;
  display: flex; align-items: center; justify-content: center;
  width: 100%;
}
.sidebar-scan-phrase p {
  margin: 0; font-size: 0.82rem;
  color: var(--text-secondary);
  white-space: nowrap;
}

/* ── 副标题/进度详情 ── */
.sidebar-scan-sub {
  font-size: 0.73rem; color: #bfbbb6;
  line-height: 1.5;
  margin-top: 2px;
}
.sidebar-scan-sub b { color: var(--text-secondary); font-weight: 600; }
.sidebar-scan-count {
  display: block; font-size: 0.7rem;
  color: #c5bfb8; margin-top: 2px;
}

/* ── Peek Modal ── */
.peek-overlay {
  position: fixed; inset: 0; z-index: 1100;
  background: rgba(0,0,0,0.3); backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center; padding: 20px;
}
.peek-dialog { display: none; } /* 保留旧类名避免报错，新样式见 .peek-film */
.peek-film {
  width: fit-content; max-width: 90vw; max-height: 90vh;
  display: flex; flex-direction: column;
  box-shadow: 0 12px 52px rgba(0,0,0,0.4);
}

/* ── 胶卷上下黑边 + 白色矩形齿孔 ── */
.pk-film-edge {
  height: 20px; flex-shrink: 0;
  background: #111;
  position: relative;
  overflow: hidden;
}
.pk-film-edge::before {
  content: '';
  position: absolute;
  top: 4px; bottom: 4px; left: 11px; right: 11px;
  /* 白色矩形齿孔：8px宽 间距14px */
  background: repeating-linear-gradient(
    90deg,
    rgba(255,255,255,0.88) 0px,
    rgba(255,255,255,0.88) 8px,
    transparent 8px,
    transparent 22px
  );
}
/* ── 底部信息栏（原 pk-top + footer 合并）── */
.pk-bar {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px;
  background: #fafaf9; flex-shrink: 0;
  position: relative;
}
.pk-char { display: flex; align-items: center; gap: 10px; min-width: 0; }
.pk-char-avatar { width: 30px; height: 30px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; overflow: hidden; }
.pk-char-avatar-text { color: #fff; font-size: 13px; font-weight: 600; line-height: 1; user-select: none; }
.pk-char b { display: block; font-size: 0.85rem; color: var(--text-bright); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pk-char span { font-size: 0.72rem; color: var(--text-secondary); }
.pk-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.pk-x { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 50%; border: none; background: transparent; color: var(--text-secondary); cursor: pointer; transition: 0.15s; }
.pk-x:hover { background: rgba(0,0,0,0.06); }
.pk-body { flex-shrink: 0; display: flex; align-items: center; justify-content: center; background: #111; overflow: hidden; }

/* ═══ 相机快门动画 ═══ */
.pk-shutter-stage {
  position: relative; width: 100%; height: 100%;
  overflow: hidden;
}
/* ── 白色闪光（模拟闪光灯）── */
.pk-shutter-flash {
  position: absolute; inset: 0; z-index: 10;
  background: #fff;
  opacity: 0; pointer-events: none;
}
.pk-shutter-fire .pk-shutter-flash {
  animation: shutter-flash 0.35s cubic-bezier(0.4, 0, 0.2, 1) forwards;
}
@keyframes shutter-flash {
  0%   { opacity: 0.85; }
  45%  { opacity: 0.6; }
  100% { opacity: 0; }
}

/* ── 快门帘幕（双帘式焦平面快门）── */
.pk-shutter-curtain {
  position: absolute; left: 0; right: 0; z-index: 9;
  height: 51%; /* 略超 50% 防漏缝 */
  background: linear-gradient(180deg,
    #1a1a1a 0%,
    #2a2a2a 30%,
    #1a1a1a 100%
  );
  pointer-events: none;
}
.pk-curtain-top {
  top: 0;
  transform-origin: top center;
  box-shadow: 0 2px 8px rgba(0,0,0,0.5);
}
.pk-curtain-bottom {
  bottom: 0;
  transform-origin: bottom center;
  box-shadow: 0 -2px 8px rgba(0,0,0,0.5);
}

.pk-shutter-fire .pk-curtain-top {
  animation: shutter-open-top 0.38s 0.04s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards;
}
.pk-shutter-fire .pk-curtain-bottom {
  animation: shutter-open-bottom 0.38s 0.04s cubic-bezier(0.25, 0.46, 0.45, 0.94) forwards;
}

@keyframes shutter-open-top {
  0%   { transform: scaleY(1); }
  100% { transform: scaleY(0); }
}
@keyframes shutter-open-bottom {
  0%   { transform: scaleY(1); }
  100% { transform: scaleY(0); }
}

.pk-wait { text-align: center; padding: 32px 24px; color: var(--text-secondary); }
.pk-wait p { margin: 10px 0 0; font-size: 0.85rem; }

/* 加载文案轮播容器 */
.pk-wait-phrase {
  position: relative;
  min-height: 24px;
  display: flex; align-items: center; justify-content: center;
}
.pk-wait-phrase p {
  margin: 10px 0 0; font-size: 0.88rem;
  white-space: nowrap;
}

/* phrase 过渡动画：上浮消失 + 从下方浮入 */
.phrase-enter-active,
.phrase-leave-active {
  transition: all 0.45s cubic-bezier(0.4, 0, 0.2, 1);
}
.phrase-leave-to {
  transform: translateY(-14px);
  opacity: 0;
}
.phrase-enter-from {
  transform: translateY(14px);
  opacity: 0;
}
.pk-wait span { font-size: 0.73rem; color: #bfbbb6; }
.loader-ring { width: 36px; height: 36px; margin: 0 auto; border: 3px solid var(--border); border-top-color: var(--accent); border-radius: 50%; animation: spin 0.8s linear infinite; }
/* 环形进度条（参照 ImageGenBubble） */
.pk-ring-container { position: relative; width: 80px; height: 80px; margin: 0 auto 8px; }
.pk-ring { width: 80px; height: 80px; transform: rotate(-90deg); }
.pk-ring-progress { transition: stroke-dashoffset 0.4s ease; }
.pk-ring-pct {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  font-size: 16px; font-weight: 600; color: var(--accent);
}
.pk-err { text-align: center; padding: 36px; }
.pk-err p { color: #ff4d4f; margin: 0 0 4px; font-size: 0.9rem; }
.pk-err span { display: block; font-size: 0.78rem; color: var(--text-secondary); margin-bottom: 12px; }
.pk-img { width: 100%; height: 100%; object-fit: contain; display: block; cursor: pointer; }
.pk-retake-btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 6px 16px; border: 1px solid rgba(224,123,108,0.2); border-radius: 999px;
  background: transparent; color: var(--accent);
  font-size: 0.8rem; cursor: pointer; transition: 0.15s;
  white-space: nowrap;
}
.pk-retake-btn:hover:not(:disabled) {
  background: rgba(224,123,108,0.06);
  border-color: rgba(224,123,108,0.4);
}
.pk-retake-btn:disabled { opacity: 0.4; cursor: not-allowed; }

.modal-enter-active, .modal-leave-active { transition: opacity 0.2s; }
.modal-enter-active .peek-film, .modal-leave-active .peek-film { transition: transform 0.2s cubic-bezier(0.4,0,0.2,1); }
.modal-enter-from, .modal-leave-to { opacity: 0; }
.modal-enter-from .peek-film { transform: scale(0.95) translateY(10px); }
.modal-leave-to .peek-film { transform: scale(0.95) translateY(10px); }

/* ── 重置世界线弹窗 ── */
.reset-overlay {
  position: fixed; inset: 0; z-index: 1200;
  background: rgba(0,0,0,0.3); backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center; padding: 20px;
}
.reset-dialog {
  background: #fff; border: 1px solid var(--border);
  border-radius: 16px; width: 100%; max-width: 440px;
  overflow: hidden;
  box-shadow: 0 8px 40px rgba(0,0,0,0.1);
}
.reset-progress-dialog { max-width: 460px; }
.reset-dialog-header {
  display: flex; align-items: center; gap: 10px;
  padding: 18px 20px 14px;
  font-size: 1rem; font-weight: 700; color: var(--text-bright);
}
.reset-dialog-desc {
  margin: 0; padding: 0 20px 18px;
  font-size: 0.88rem; color: var(--text-secondary); line-height: 1.6;
}
.reset-dialog-actions {
  display: flex; gap: 12px; padding: 16px 20px;
  border-top: 1px solid var(--glass-border);
}
.reset-btn-cancel {
  flex: 1; padding: 10px 0;
  border: 1px solid var(--border); border-radius: 12px;
  background: var(--glass-bg); color: var(--text-secondary);
  font-size: 0.88rem; cursor: pointer; transition: 0.15s;
}
.reset-btn-cancel:hover { background: var(--bg-hover); color: var(--text-bright); }
.reset-btn-confirm {
  flex: 1; padding: 10px 0;
  border: none; border-radius: 12px;
  background: linear-gradient(120deg, #f8edea 0%, #f2eaf4 35%, #eaf0f8 65%, #f8edea 100%);
  background-size: 200% 200%;
  color: #c06a5a;
  font-size: 0.88rem; font-weight: 600; cursor: pointer; transition: 0.3s;
}
.reset-btn-confirm:hover {
  animation: waterflow 1s ease-in-out infinite;
  box-shadow: 0 3px 20px rgba(224,123,108,0.10);
}
.reset-btn-bg {
  flex: 1; padding: 10px 0;
  border: 1px dashed var(--border); border-radius: 12px;
  background: transparent; color: var(--text-secondary);
  font-size: 0.85rem; cursor: pointer; transition: 0.15s;
}
.reset-btn-bg:hover { border-color: var(--accent); color: var(--accent); }

/* 进度条 */
.reset-progress-bar-wrap {
  display: flex; align-items: center; gap: 12px;
  padding: 0 20px 14px;
}
.reset-progress-bar {
  flex: 1; height: 8px;
  border-radius: 4px; background: var(--bg-hover);
  overflow: hidden;
}
.reset-progress-fill {
  height: 100%; border-radius: 4px;
  background: var(--accent);
  transition: width 0.3s ease;
}
.reset-progress-fill.done { background: #52c41a; }
.reset-progress-fill.cancelled { background: #faad14; }
.reset-progress-text {
  font-size: 0.85rem; font-weight: 600; color: var(--text-secondary);
  min-width: 60px; text-align: right;
}

/* 当前任务 */
.reset-current-task {
  display: flex; align-items: center; gap: 10px;
  padding: 0 20px 10px;
  font-size: 0.85rem; color: var(--text-secondary);
}
.reset-current-task b { color: var(--text-bright); }
.reset-current-task.done { color: #52c41a; }
.reset-current-task.cancelled { color: #faad14; }
.loader-ring-sm {
  width: 18px; height: 18px;
  border: 2px solid var(--border); border-top-color: var(--accent);
  border-radius: 50%; animation: spin 0.8s linear infinite; flex-shrink: 0;
}

/* 错误列表 */
.reset-errors {
  margin: 0 20px 6px; padding: 10px 12px;
  background: rgba(255,77,79,0.05); border-radius: 10px;
  max-height: 120px; overflow-y: auto;
}
.reset-error-item {
  display: flex; gap: 8px; padding: 3px 0;
  font-size: 0.78rem;
}
.reset-error-name { color: #ff4d4f; flex-shrink: 0; font-weight: 600; }
.reset-error-msg { color: var(--text-secondary); word-break: break-all; }

/* ── Responsive ── */
@media (max-width: 767px) {
  .schedule-view { position: relative; }
  .main-topbar {
    padding: 12px 16px;
    position: absolute; top: 0; left: 0; right: 0; z-index: 20;
  }
  .topbar-row h2 { font-size: 1rem; }
  .card-grid {
    grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
    gap: 8px; padding: 80px 10px 8px;
  }
  .peek-film { max-width: 94vw; border-radius: 4px; }
  .reset-dialog { max-width: 94vw; border-radius: 12px; }

  /* 移动端 retake 按钮：仅图标 + 定位 pk-bar 右端 */
  .pk-retake-label { display: none; }
  .pk-retake-btn {
    position: absolute; right: 9px; top: 50%; transform: translateY(-50%);
    padding: 7px 7px;
  }
  .pk-bar { padding-right: 80px; }
  .pk-x { margin-left: 0; }

  /* 移动端：扫描面板缩为底部横条（绝对定位，不挤压 card-grid）*/
  .sched-sidebar {
    top: auto; left: 0; right: 0; bottom: 0;
    width: 100%; max-height: 130px;
    border-left: none; border-top: 1px solid rgba(224,123,108,0.18);
  }
  .sidebar-scan-ring { width: 56px; height: 56px; }
  .sidebar-scan-icon { width: 56px; height: 56px; }
  .sidebar-scan-pct { font-size: 14px; }
  .sidebar-scan-content { flex-direction: row; flex-wrap: wrap; gap: 6px 14px; padding: 14px 16px; }
  .sidebar-scan-label { font-size: 12px; }
  .sidebar-scan-phrase p { font-size: 0.75rem; }
  .sidebar-scan-sub { font-size: 0.7rem; width: 100%; text-align: center; }
  .sidebar-scan-count { display: inline; }
}

@media (min-width: 768px) and (max-width: 1023px) {
  .card-grid { grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); }
  /* 平板端：sidebar 收窄 */
  .sched-sidebar { width: 220px; }
}

@media (min-width: 1024px) {
  .card-grid { grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); }
}
</style>

<style>
/* lightbox 必须在 peek-overlay (z-index:1100) 之上 */
.vel-modal, .vel-img-wrapper, .vel-img {
  z-index: 1300 !important;
}

/* ── 瞄一眼图片悬浮 description 提示框（z-index 高于 peek-overlay 1100）── */
.lightbox-tooltip {
  position: fixed;
  z-index: 1150;
  max-width: 340px;
  padding: 10px 16px;
  background: rgba(0, 0, 0, 0.78);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  color: #f0e8e0;
  font-size: 0.85rem;
  line-height: 1.65;
  border-radius: 10px;
  pointer-events: none;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.35);
}

.lbtip-enter-active,
.lbtip-leave-active {
  transition: opacity 0.18s ease;
}
.lbtip-enter-from,
.lbtip-leave-to {
  opacity: 0;
}
</style>
