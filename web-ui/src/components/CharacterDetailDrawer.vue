<template>
  <Teleport to="body">
    <Transition name="drawer">
      <div v-if="open" class="drawer-overlay" @click.self="$emit('close')">
        <div class="drawer-panel" @click.stop>
          <!-- 头部：分两行 -->
          <div class="dr-header">
            <!-- Row 1: 头像 + 信息 + 关闭 -->
            <div class="dr-row1">
              <div
                class="dr-avatar"
                :style="char?.avatar_path ? { backgroundImage: `url(${char.avatar_path})`, backgroundSize:'cover', backgroundPosition:'center' } : { background: '#e07b6c' }"
              >
                <span v-if="!char?.avatar_path" class="dr-avatar-text">{{ char?.display_name?.charAt(0) || '' }}</span>
              </div>
              <div class="dr-info">
                <h3>{{ char?.display_name || '' }}</h3>
                <div v-if="currentAct" class="dr-now">
                  <div class="dr-now-line">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    <span>{{ currentAct.activity }}</span>
                  </div>
                  <div class="dr-now-line">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                    <span>{{ currentAct.location }}</span>
                  </div>
                </div>
                <div v-else class="dr-now dr-no-data">还没安排日程</div>
              </div>
              <button class="dr-close" @click="$emit('close')">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>

            <!-- Row 2: 操作按钮 -->
            <div class="dr-row2">
              <button v-if="activities.length > 0" class="dr-btn" @click="$emit('peek')">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                <span>瞄一眼</span>
              </button>
              <button class="dr-btn" @click="$emit('regenerate')" :disabled="regenerating">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="1 4 1 10 7 10"/><polyline points="23 20 23 14 17 14"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>
                <span>{{ scheduleBtnText }}</span>
              </button>
              <!-- 睡眠中 → 叫醒/摇醒按钮（三选一） -->
              <template v-if="char?.is_sleeping && !char?.is_temp_woken">
                <!-- 被上门摇醒过 → 摇醒 -->
                <button v-if="char?.was_door_woken" class="dr-btn" :class="{ shaking: doorShaking }" @click="onWakeDoor">
                  <svg width="14" height="14" viewBox="0 0 1024 1024" fill="currentColor"><path d="M174.871273 264.797091c-17.501091-49.431273 2.56-111.988364 62.557091-146.618182 31.045818-17.92 63.069091-14.754909 88.482909-1.256727 18.152727 9.588364 32.768 24.203636 43.938909 39.703273 8.517818-9.541818 18.432-17.687273 29.463273-24.203637 30.626909-17.687273 62.650182-15.127273 88.389818-2.699636 24.343273 11.729455 43.287273 32.256 55.761454 53.806545l13.963637 24.203637c46.405818 80.197818 92.858182 160.256 139.403636 240.314181 6.144 10.752 13.312 20.945455 21.271273 30.487273 3.165091-10.007273 5.725091-19.688727 8.471272-30.487273l4.235637-16.523636c4.654545-17.361455 10.519273-36.957091 19.968-55.994182 20.386909-41.099636 55.202909-74.658909 117.573818-92.253091 24.808727-7.028364 47.197091 0.093091 63.534545 11.403637 15.546182 10.845091 26.810182 26.158545 34.583273 40.96 14.708364 28.020364 23.458909 67.723636 13.032727 102.027636l-0.558545 2.234182c-12.427636 46.452364-25.553455 92.765091-39.330909 138.845091-11.170909 37.701818-23.272727 75.077818-36.305455 112.174545-11.589818 32.628364-24.110545 64.186182-36.119272 84.526546-37.050182 76.101818-97.466182 140.567273-172.311273 184.506182a41.984 41.984 0 0 1-57.530182-14.522182 41.937455 41.937455 0 0 1 15.453091-57.297455c61.160727-35.886545 109.847273-88.482909 139.310545-149.643636a43.240727 43.240727 0 0 1 2.001455-3.723637c7.261091-11.869091 17.687273-36.631273 29.835636-70.74909 12.520727-35.746909 24.203636-71.866182 34.909091-108.218182 13.591273-45.149091 26.437818-90.577455 38.632728-136.192l0.558545-2.234182 0.186182-0.651636 0.558545-2.001455a39.563636 39.563636 0 0 0 0.325818-16.523636 75.543273 75.543273 0 0 0-7.447272-23.179637 44.171636 44.171636 0 0 0-6.702546-9.774545c-35.281455 11.170909-49.524364 27.927273-58.693818 46.452363-5.585455 11.217455-9.728 24.203636-13.963636 40.261819-1.117091 4.002909-2.234182 8.378182-3.397818 13.032727-3.165091 12.241455-6.749091 26.251636-10.891637 39.237818v0.139636c-7.307636 22.109091-18.944 45.009455-40.401454 58.042182-25.134545 15.220364-50.641455 9.867636-67.863273 0.837818-16.058182-8.424727-29.277091-21.736727-39.098182-33.559272a290.629818 290.629818 0 0 1-26.996364-39.098182c-46.592-80.058182-93.090909-160.209455-139.403636-240.500364l-14.056727-24.296727c-6.237091-10.798545-14.103273-17.92-20.247273-20.852364a12.8 12.8 0 0 0-5.445818-1.536 6.842182 6.842182 0 0 0-3.584 1.163637 41.937455 41.937455 0 0 0-17.268364 21.364363 29.044364 29.044364 0 0 0 1.954909 25.6l108.823273 188.509091a41.984 41.984 0 0 1-15.825454 57.157818 41.984 41.984 0 0 1-57.437091-14.894545l-155.461819-269.265455c-6.842182-11.915636-14.708364-19.316364-20.340363-22.295272a9.355636 9.355636 0 0 0-3.863273-1.349818h-0.465454a8.331636 8.331636 0 0 0-1.95491 0.930909c-30.394182 17.547636-27.834182 41.658182-22.807272 49.664l0.791272 1.396363 36.165819 63.162182a39.749818 39.749818 0 0 1 1.815272 3.118546l117.76 205.824a41.984 41.984 0 0 1-16.104727 57.111272 41.984 41.984 0 0 1-57.344-15.127272L222.952727 351.976727a30.254545 30.254545 0 0 0-13.125818-8.750545c-2.234182-0.512-6.842182-1.256727-15.825454 3.909818a36.724364 36.724364 0 0 0-16.570182 19.362909c-2.141091 6.423273-2.513455 15.034182 3.863272 26.112l138.705455 240.267636a41.984 41.984 0 0 1-15.778909 57.204364 41.984 41.984 0 0 1-57.437091-14.941091l-79.36-137.448727a29.044364 29.044364 0 0 0-6.330182-2.56 10.752 10.752 0 0 0-5.585454-0.279273c-0.930909 0.279273-4.142545 1.303273-9.262546 6.981818-11.264 12.567273-13.498182 23.970909-11.496727 35.979637 2.327273 14.010182 11.217455 31.464727 27.927273 50.269091 127.301818 143.778909 191.860364 214.434909 229.236363 245.992727 32.954182 27.880727 75.776 44.730182 122.786909 47.476364 23.226182 1.349818 40.727273 21.131636 39.051637 44.218181a42.682182 42.682182 0 0 1-45.056 39.237819c-64.186182-3.723636-124.555636-26.903273-171.985455-67.025455-43.008-36.398545-112.546909-112.872727-237.661091-254.277818-22.481455-25.413818-41.611636-56.413091-47.383272-90.996364-6.190545-36.584727 3.211636-73.914182 31.976727-105.984 10.472727-12.055273 23.505455-21.643636 38.120727-28.113454l-13.730909-23.738182c-37.888-65.629091-4.887273-131.397818 44.357818-159.837091 7.447273-4.282182 14.941091-7.68 22.528-10.24z" fill="currentColor"/><path d="M606.952727 63.301818l84.107637 148.107637 45.381818-208.756364zM704 201.402182l140.567273-123.298909 99.514182 76.613818z" fill="currentColor"/></svg>
                  <span>怎么又睡了</span>
                </button>
                <!-- 三次电话未叫醒 → 上门摇醒 -->
                <button v-else-if="(char?.wake_attempts || 0) >= 3" class="dr-btn" :class="{ shaking: doorShaking }" @click="onWakeDoor">
                  <svg width="14" height="14" viewBox="0 0 1024 1024" fill="currentColor"><path d="M778.971429 13.312H211.894857c-32.914286 0-58.587429 28.672-58.587428 65.243429v902.144h84.772571V98.084571h508.928l-378.88 33.28V1007.908571l384.731429-31.378285v4.242285H837.485714V78.555429c0-36.571429-25.746286-65.243429-58.514285-65.243429zM416.914286 536.429714a24.868571 24.868571 0 1 1 0-49.664 24.868571 24.868571 0 0 1 0 49.737143z" fill="currentColor"/></svg>
                  <span>上门摇醒</span>
                </button>
                <!-- 默认 → 电话叫醒 -->
                <button v-else class="dr-btn" :class="{ shaking: phoneShaking }" @click="onWakePhone">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                  <span>电话叫醒</span>
                </button>
              </template>
              <!-- 正常 → 聊天按钮 -->
              <button v-else class="dr-btn" @click="$emit('chat')">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 1 1 2 2z"/></svg>
                <span>聊天</span>
              </button>
            </div>
          </div>

          <!-- 时间轴 -->
          <div class="dr-body" :class="{ 'dr-body-scanning': scanActive }">
            <!-- 扫描特效遮罩（酒馆同款）-->
            <div v-if="scanVisible" class="dr-scan-overlay">
              <div class="dr-scan-line"></div>
              <div class="dr-scan-glow"></div>
              <div class="dr-scan-content">
                <div class="dr-scan-icon">
                  <svg viewBox="0 0 80 80" class="dr-scan-ring">
                    <circle cx="40" cy="40" r="34" fill="none" stroke="rgba(224,123,108,0.12)" stroke-width="2.5"/>
                    <circle cx="40" cy="40" r="34" fill="none" stroke="var(--accent)"
                      stroke-width="2.5" stroke-linecap="round"
                      stroke-dasharray="214"
                      :stroke-dashoffset="214 * (1 - scanProgress / 100)"
                      class="dr-scan-ring-fill"
                    />
                  </svg>
                  <div class="dr-scan-pct">{{ scanProgress }}%</div>
                </div>
                <div class="dr-scan-label">{{ scanLabel }}</div>
                <div class="dr-scan-phrase">
                  <Transition name="phrase" mode="out-in">
                    <p :key="currentScanTip">{{ scanTips[currentScanTip] }}</p>
                  </Transition>
                </div>
              </div>
            </div>

            <!-- 加载骨架 -->
            <div v-if="loading" class="dr-skel">
              <div class="sk-line" v-for="n in 5" :key="n" :style="{ width: (50 + Math.random() * 45) + '%' }"></div>
            </div>

            <!-- 空 -->
            <div v-else-if="!activities.length" class="dr-empty">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" opacity="0.25"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
              <p>还没有日程安排</p>
            </div>

            <!-- 时间轴 -->
            <div v-else class="dr-timeline">
              <div
                v-for="(act, i) in activities"
                :key="i"
                class="tl-item"
                @mouseenter="(e) => onEnter(e, act.description)"
                @mousemove="onMove"
                @mouseleave="onLeave"
                :class="{
                  'tl-curr': act.isCurrent,
                  'tl-sleep': act.replyDelay === -1,
                }"
              >
                <div class="tl-node">
                  <div class="tl-d"></div>
                  <div v-if="i < activities.length - 1" class="tl-l"></div>
                </div>
                <div class="tl-t">{{ act.startTime }}</div>
                <div class="tl-content">
                  <div class="tl-top">
                    <span class="tl-act">{{ act.activity }}</span>
                    <button class="tl-peek-btn" title="瞄一眼这个瞬间" @click.stop="$emit('peekAt', act)">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                    </button>
                  </div>
                  <div class="tl-loc">{{ act.location }}</div>
                  <div v-if="act.isCurrent" class="tl-mark">
                    <span class="pulse"></span>此刻
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- Tooltip -->
    <Teleport to="body">
      <div
        v-if="tooltip.show"
        class="hover-tip"
        :class="{ flip: tooltip.flip }"
        :style="tipStyle"
      >{{ tooltip.text }}</div>
    </Teleport>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch, onUnmounted } from 'vue'
import { useTooltip } from '../composables/useTooltip.js'

const props = defineProps<{
  open: boolean
  char: any
  activities: any[]
  loading: boolean
  peekBusy: boolean
  regenerating?: boolean
}>()

const emit = defineEmits(['close', 'peek', 'regenerate', 'chat', 'wakePhone', 'wakeDoor', 'peekAt'])

const { tooltip, tipStyle, onEnter, onMove, onLeave } = useTooltip()

const currentAct = computed(() => props.activities.find((a: any) => a.isCurrent) || null)

const scheduleBtnText = computed(() => {
  if (props.regenerating) return '生成中...'
  if (!props.loading && !props.activities.length) return '为ta制作日程表'
  return '改变ta的日程'
})

// ── 叫醒系统 ──
const phoneShaking = ref(false)
const doorShaking = ref(false)

function onWakePhone() {
  phoneShaking.value = true
  setTimeout(() => { phoneShaking.value = false }, 1600)
  setTimeout(() => { emit('wakePhone') }, 1000)
}

function onWakeDoor() {
  doorShaking.value = true
  setTimeout(() => { doorShaking.value = false }, 1600)
  setTimeout(() => { emit('wakeDoor') }, 1000)
}


// ── 扫描特效控制 ──
const scanActive = computed(() => props.regenerating)

const scanLabel = computed(() => {
  if (props.regenerating) return '日程重新编排中'
  return '日程加载中'
})

// 脉冲进度（loading/regenerating 用 interval 驱动，最后卡99%，数据到后跳100%再消失）
const scanVisible = ref(false)
const scanProgress = ref(0)
let _scanPulseTimer: ReturnType<typeof setInterval> | null = null
let _scanCompleteTimer: ReturnType<typeof setTimeout> | null = null

watch(scanActive, (active) => {
  if (active) {
    if (_scanCompleteTimer) { clearTimeout(_scanCompleteTimer); _scanCompleteTimer = null }
    scanVisible.value = true
    scanProgress.value = 0
    _scanPulseTimer = setInterval(() => {
      if (scanProgress.value < 99) {
        scanProgress.value = Math.min(99, scanProgress.value + 1)
      }
    }, 180)
  } else {
    if (_scanPulseTimer) { clearInterval(_scanPulseTimer); _scanPulseTimer = null }
    // 跳到 100%，短暂停留后隐藏遮罩
    scanProgress.value = 100
    _scanCompleteTimer = setTimeout(() => {
      scanVisible.value = false
      scanProgress.value = 0
    }, 600)
  }
})

// ── 过渡文字轮播 ──
const scanTips = [
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
const currentScanTip = ref(0)
let _scanTipTimer: ReturnType<typeof setInterval> | null = null

function startScanTips() {
  currentScanTip.value = 0
  let idx = 0
  _scanTipTimer = setInterval(() => {
    idx = (idx + 1) % scanTips.length
    currentScanTip.value = idx
  }, 2200)
}

function stopScanTips() {
  if (_scanTipTimer) { clearInterval(_scanTipTimer); _scanTipTimer = null }
}

watch(scanActive, (active) => {
  if (active) startScanTips()
  else stopScanTips()
}, { immediate: true })

onUnmounted(() => {
  stopScanTips()
  if (_scanPulseTimer) { clearInterval(_scanPulseTimer); _scanPulseTimer = null }
  if (_scanCompleteTimer) { clearTimeout(_scanCompleteTimer); _scanCompleteTimer = null }
})

</script>

<style scoped>
/* ── Overlay ── */
.drawer-overlay {
  position: fixed; inset: 0; z-index: 900;
  background: rgba(0,0,0,0.2);
  display: flex; justify-content: flex-end;
}
.drawer-panel {
  width: 420px; max-width: 92vw; height: 100vh; height: 100dvh;
  background: #fff; border-left: 1px solid var(--border);
  display: flex; flex-direction: column;
  box-shadow: -4px 0 30px rgba(0,0,0,0.08);
}

/* ── Header ── */
.dr-header {
  padding: 20px 20px 14px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  display: flex; flex-direction: column; gap: 14px;
}

/* Row 1: avatar + info + close */
.dr-row1 {
  display: flex; align-items: center; gap: 14px;
}

.dr-avatar {
  width: 52px; height: 52px; border-radius: 50%;
  flex-shrink: 0;
  box-shadow: 0 2px 8px rgba(0,0,0,0.06);
  display: flex; align-items: center; justify-content: center;
  overflow: hidden;
}
.dr-avatar-text {
  color: #fff; font-size: 22px; font-weight: 600;
  line-height: 1; user-select: none;
}

.dr-info {
  flex: 1; min-width: 0;
}
.dr-info h3 {
  margin: 0; font-size: 1.05rem; font-weight: 700; color: var(--text-bright);
  line-height: 1.3;
}
.dr-now {
  display: flex; flex-direction: column; gap: 3px;
  margin-top: 4px; font-size: 0.8rem; color: var(--text-secondary);
  overflow: hidden;
}
.dr-no-data {
  color: #bfbbb6; font-style: italic;
}

.dr-now-line {
  display: flex; align-items: center; gap: 6px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.dr-now-line svg { flex-shrink: 0; opacity: 0.4; color: var(--text-secondary); }

.dr-close {
  display: none; align-items: center; justify-content: center;
  width: 34px; height: 34px; flex-shrink: 0;
  border: 1px solid var(--border); border-radius: 50%;
  background: var(--glass-bg); color: var(--text-secondary);
  cursor: pointer; transition: 0.15s; padding: 0;
}
.dr-close:hover { background: rgba(255,77,79,0.08); color: #ff4d4f; border-color: rgba(255,77,79,0.2); }


/* Row 2: action buttons */
.dr-row2 {
  display: flex; gap: 8px;
}

.dr-btn {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 5px 10px;
  border: 1px solid var(--accent); border-radius: 8px;
  background: var(--accent);
  color: #fff; font-size: 0.82rem;
  cursor: pointer; transition: 0.15s;
}
.dr-btn svg { flex-shrink: 0; }
.dr-btn:hover:not(:disabled) { background: var(--accent-hover); border-color: var(--accent-hover); box-shadow: 0 2px 12px rgba(224, 123, 108, 0.25); }
.dr-btn:disabled { opacity: 0.35; cursor: not-allowed; }


/* ── Body ── */
.dr-body { flex: 1; overflow-y: auto; padding: 14px 20px; user-select: none; cursor: default; position: relative; scrollbar-width: none; }
.dr-body::-webkit-scrollbar { display: none; }
.dr-body-scanning { overflow: hidden; }

.dr-skel { padding: 8px 0; }
.sk-line { height: 11px; border-radius: 6px; background: var(--bg-hover); margin-bottom: 10px; animation: sk 1.5s ease-in-out infinite; }
@keyframes sk { 0%,100%{opacity:.3} 50%{opacity:.7} }

/* ═══════════════════════════════════════════
   扫描特效遮罩（酒馆同款）
   ═══════════════════════════════════════════ */
.dr-scan-overlay {
  position: absolute; inset: 0; z-index: 10;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  background: rgba(255, 255, 255, 0.82);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  overflow: hidden;
}

/* ── 扫描线（酒馆同款）── */
.dr-scan-line {
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
  animation: dr-scan-sweep 2.4s ease-in-out infinite;
  box-shadow: 0 0 28px rgba(224,123,108,0.55), 0 0 10px rgba(224,123,108,0.25);
  z-index: 2;
  pointer-events: none;
}

@keyframes dr-scan-sweep {
  0%   { top: 8%;  opacity: 0.15; }
  22%  { top: 92%; opacity: 1; }
  44%  { top: 92%; opacity: 0.15; }
  66%  { top: 8%;  opacity: 1; }
  88%  { top: 8%;  opacity: 0.15; }
  100% { top: 8%;  opacity: 0.15; }
}

/* ── 扫描光晕 ── */
.dr-scan-glow {
  position: absolute;
  left: 20%; right: 20%;
  height: 60px;
  background: radial-gradient(ellipse at center,
    rgba(224,123,108,0.12) 0%,
    rgba(224,123,108,0.04) 40%,
    transparent 70%
  );
  animation: dr-glow-follow 2.4s ease-in-out infinite;
  z-index: 1;
  pointer-events: none;
  filter: blur(8px);
}

@keyframes dr-glow-follow {
  0%   { top: 6%;  opacity: 0.2; }
  22%  { top: 72%; opacity: 0.9; }
  44%  { top: 72%; opacity: 0.2; }
  66%  { top: 6%;  opacity: 0.9; }
  88%  { top: 6%;  opacity: 0.2; }
  100% { top: 6%;  opacity: 0.2; }
}

/* ── 扫描文字内容区 ── */
.dr-scan-content {
  position: relative; z-index: 3;
  display: flex; flex-direction: column;
  align-items: center; gap: 10px;
  padding: 24px 20px;
  text-align: center;
}

/* ── 环形进度 ── */
.dr-scan-icon {
  position: relative; width: 72px; height: 72px;
  margin-bottom: 4px;
}
.dr-scan-ring {
  width: 72px; height: 72px;
  transform: rotate(-90deg);
}
.dr-scan-ring-fill {
  transition: stroke-dashoffset 0.5s ease;
}
.dr-scan-pct {
  position: absolute; top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  font-size: 17px; font-weight: 700;
  color: var(--accent);
}

/* ── 状态标签 ── */
.dr-scan-label {
  font-size: 13px; font-weight: 700;
  color: var(--accent);
  letter-spacing: 0.08em;
  animation: dr-label-pulse 1.4s ease-in-out infinite;
}

@keyframes dr-label-pulse {
  0%, 100% { opacity: 0.5; }
  50%      { opacity: 1; }
}

/* ── 过渡文字轮播 ── */
.dr-scan-phrase {
  position: relative;
  min-height: 22px;
  display: flex; align-items: center; justify-content: center;
  width: 100%;
}
.dr-scan-phrase p {
  margin: 0; font-size: 0.82rem;
  color: var(--text-secondary);
  white-space: nowrap;
}

/* phrase 过渡动画（与 ScheduleView 共用） */
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

.dr-empty {
  display: flex; flex-direction: column; align-items: center;
  justify-content: center; padding: 48px 0; color: var(--text-secondary);
  gap: 8px;
}
.dr-empty p { margin: 0; font-size: 0.9rem; }

/* ── Timeline ── */
.tl-item {
  display: grid; grid-template-columns: 18px 50px 1fr;
  gap: 8px; align-items: start; padding: 4px 0;
}

.tl-node { display: flex; flex-direction: column; align-items: center; padding-top: 5px; }
.tl-d { width: 9px; height: 9px; border-radius: 50%; background: #d9d9d9; flex-shrink: 0; }
.tl-curr .tl-d { background: #52c41a; box-shadow: 0 0 0 4px rgba(82,196,26,0.12); }
.tl-sleep .tl-d { background: #bfbfbf; }
.tl-l { width: 1.5px; flex: 1; min-height: 22px; background: var(--border); margin-top: 3px; }
.tl-item:last-child .tl-l { display: none; }

.tl-t {
  font-size: 0.7rem; color: var(--text-secondary);
  font-variant-numeric: tabular-nums; padding-top: 3px; white-space: nowrap;
}
.tl-curr .tl-t { color: #389e0d; font-weight: 600; }

.tl-content {
  background: var(--glass-bg); border: 1px solid var(--glass-border);
  border-radius: 8px; padding: 0px 12px 8px;
  position: relative;
}
.tl-curr .tl-content { border-color: rgba(82,196,26,0.2); background: rgba(82,196,26,0.03); }

.tl-top { display: flex; align-items: center; gap: 6px; }
.tl-act { font-size: 0.85rem; color: var(--text-bright); font-weight: 500; }
.tl-peek-btn {
  display: inline-flex; align-items: center; justify-content: center;
  width: 26px; height: 26px; flex-shrink: 0;
  border: none; border-radius: 50%;
  background: transparent; color: var(--text-secondary);
  cursor: pointer; opacity: 0; transition: opacity 0.2s, background 0.15s, color 0.15s;
  margin-left: auto; padding: 0;
}
.tl-item:hover .tl-peek-btn { opacity: 0.35; }
.tl-peek-btn:hover { opacity: 1 !important; background: rgba(224,123,108,0.1); color: var(--accent); }
.tl-loc { font-size: 0.75rem; color: var(--text-secondary); margin-top: 3px; }

.tl-mark {
  display: flex; align-items: center; gap: 5px; margin-top: 6px;
  font-size: 0.75rem; font-weight: 600; color: #389e0d;
}
.pulse {
  width: 7px; height: 7px; border-radius: 50%; background: #52c41a;
  animation: pulse2 2s ease-in-out infinite;
}
@keyframes pulse2 {
  0%,100%{ box-shadow:0 0 0 0 rgba(82,196,26,0.5) }
  50%{ box-shadow:0 0 0 5px rgba(82,196,26,0) }
}

/* ── Transition ── */
.drawer-enter-active, .drawer-leave-active { transition: opacity 0.2s; }
.drawer-enter-active .drawer-panel, .drawer-leave-active .drawer-panel { transition: transform 0.25s cubic-bezier(0.4,0,0.2,1); }
.drawer-enter-from, .drawer-leave-to { opacity: 0; }
.drawer-enter-from .drawer-panel { transform: translateX(40px); }
.drawer-leave-to .drawer-panel { transform: translateX(40px); }

@media (max-width: 767px) {
  .drawer-panel { width: 100vw; max-width: 100vw; }
  .dr-close { display: flex; }
}

/* ── Tooltip ── */
.hover-tip {
  position: fixed; z-index: 2000; pointer-events: none;
  max-width: 260px; padding: 6px 12px;
  background: rgba(40,40,40,0.88); color: #f0f0f0;
  border-radius: 8px; font-size: 0.78rem; line-height: 1.5;
  box-shadow: 0 4px 14px rgba(0,0,0,0.18);
  backdrop-filter: blur(6px);
}

/* ── Wake Buttons ── */
.wake-phone-btn {
  background: rgba(108,160,224,0.1);
  border-color: rgba(108,160,224,0.25);
  color: #7eb8f4;
}
.wake-phone-btn:hover:not(:disabled) {
  background: rgba(108,160,224,0.18);
  border-color: rgba(108,160,224,0.35);
}
.wake-door-btn {
  background: rgba(224,142,108,0.1);
  border-color: rgba(224,142,108,0.25);
  color: #f0a878;
}
.wake-door-btn:hover:not(:disabled) {
  background: rgba(224,142,108,0.18);
  border-color: rgba(224,142,108,0.35);
}
.shaking {
  animation: phone-shake 0.4s ease-in-out 2;
}
@keyframes phone-shake {
  0%, 100% { transform: translateX(0); }
  15% { transform: translateX(-4px) rotate(-2deg); }
  30% { transform: translateX(4px) rotate(2deg); }
  45% { transform: translateX(-3px) rotate(-1deg); }
  60% { transform: translateX(3px) rotate(1deg); }
  75% { transform: translateX(-1px); }
}
</style>
