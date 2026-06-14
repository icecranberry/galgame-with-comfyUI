<template>
  <div class="igb">
    <!-- Generating / pending / retrying overlay (hidden when done) -->
    <div
      v-if="genStatus !== 'done' && genStatus !== 'error'"
      class="igb-gen"
      :style="genBoxStyle"
    >
      <div class="igb-placeholder" :class="{ 'igb-retrying': genStatus === 'retrying' }">
        <div class="igb-beam"></div>
        <div class="igb-ring-container">
          <svg viewBox="0 0 80 80" class="igb-ring">
            <circle cx="40" cy="40" r="34" fill="none" stroke="rgba(0,0,0,0.06)" stroke-width="3" />
            <circle cx="40" cy="40" r="34" fill="none" :stroke="ringColor"
              stroke-width="3" stroke-linecap="round"
              :stroke-dasharray="circumference"
              :stroke-dashoffset="dashOffset"
              class="igb-ring-progress"
            />
          </svg>
          <div class="igb-pct">{{ displayPct }}%</div>
        </div>
        <div class="igb-text">{{ statusText }}</div>
      </div>
    </div>

    <!-- Done: show image -->
    <template v-if="genStatus === 'done'">
      <template v-for="(img, i) in (msg.images || [])" :key="'img'+i">
        <img
          v-if="!imgError.has(i)"
          :src="img.url || img.base64"
          class="igb-img"
          @click="$emit('preview', img.url || img.base64)"
          @error="onImgError(i)"
          @load="onImgLoad"
        />
        <div v-else class="igb-missing" :style="genBoxStyle">
          <div class="igb-missing-icon">🖼️</div>
          <div class="igb-missing-text">图片不可用</div>
        </div>
      </template>
    </template>

    <!-- Error -->
    <div v-if="genStatus === 'error'" class="igb-gen" :style="genBoxStyle">
      <div class="igb-placeholder igb-error">
        <div style="font-size:36px">⚠️</div>
        <div style="margin-top:8px; font-size:13px; color:#999">生成失败，请重试</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useSettingsStore } from '../stores/settings.js'

const settings = useSettingsStore()

const props = defineProps({ msg: { type: Object, required: true } })
const emit = defineEmits(['preview', 'loaded'])

// ── 根据系统设置的宽高比计算占位容器尺寸，与 igb-img 的 max-width/max-height 对齐 ──
const GEN_MAX_W = 600   // 与 .igb-img max-width 一致
const GEN_MAX_H = 800   // 与 .igb-img max-height 一致
const GEN_MIN_W = 180
const GEN_MIN_H = 120

const genBoxStyle = computed(() => {
  const W = settings.comfyWidth
  const H = settings.comfyHeight
  // 宽度上限：JS 全局上限 600px，或 70vw（移动端适配），取较小值
  const SAFE_W = Math.min(GEN_MAX_W, (window.innerWidth || 375) * 0.7)
  if (!W || !H) return { width: `${Math.min(320, SAFE_W)}px`, height: '320px' }
  const ratio = W / H
  let w = SAFE_W
  let h = Math.round(w / ratio)
  if (h > GEN_MAX_H) {
    h = GEN_MAX_H
    w = Math.round(h * ratio)
  }
  w = Math.max(GEN_MIN_W, w)
  h = Math.max(GEN_MIN_H, h)
  return { width: `${w}px`, height: `${h}px` }
})

// 跟踪图片加载失败和完成
const imgError = reactive(new Set())
const imgLoadCount = ref(0)
// 挂载时 genStatus 已经是 done → 历史图片，不需要 loaded 通知
let loadedEmitted = props.msg.genStatus === 'done'

function onImgError(i) { imgError.add(i) }
function onImgLoad() {
  imgLoadCount.value++
  checkAllLoaded()
}
function checkAllLoaded() {
  if (loadedEmitted) return
  const imgs = props.msg.images || []
  const doneCount = imgLoadCount.value + imgError.size
  if (doneCount >= imgs.length && imgs.length > 0) {
    loadedEmitted = true
    emit('loaded')
  }
}
// 切换消息时重置
watch(() => props.msg.genId, () => {
  imgError.clear()
  imgLoadCount.value = 0
  loadedEmitted = props.msg.genStatus === 'done'
})

const circumference = 2 * Math.PI * 34

// 本地 genStatus 副本，避免 props.msg 替换后不更新
const genStatus = ref(props.msg.genStatus || 'pending')
const images = ref(props.msg.images || [])

watch(() => props.msg.genStatus, (v) => { genStatus.value = v })
watch(() => props.msg.images, (v) => { images.value = v || [] })

// ── 真实进度（ComfyUI WebSocket → KSampler step/total）──
const realPct = ref(0)  // 0~100，仅当真实>模拟时才被采纳，防止回滚
watch(() => props.msg.genProgress, (v) => {
  if (v !== undefined) realPct.value = Math.floor(v * 100)
})

// ── 模拟进度始终向前滚动，不停止 ──
const simulatedPct = ref(0)
let timer = null
let maxedOut = false

// 显示百分比：取 max(simulated, real)，保证单调不降
const displayPct = computed(() => {
  if (genStatus.value === 'done') return 100
  return Math.max(Math.floor(simulatedPct.value), realPct.value)
})

const dashOffset = computed(() => circumference * (1 - displayPct.value / 100))

// 状态文字：重试中 / 发送中
const statusText = computed(() => {
  if (genStatus.value === 'done' || genStatus.value === 'error') return ''
  if (genStatus.value === 'retrying') return '发送失败，重试中...'
  return '发送中...'
})

// 重试时 ring 变为橙色
const ringColor = computed(() => genStatus.value === 'retrying' ? '#f0a040' : '#e07b6c')

function scheduleTick() {
  timer = setTimeout(() => {
    if (genStatus.value === 'done') { simulatedPct.value = 100; return }
    if (genStatus.value === 'error') return
    // 真实进度已接管 → 模拟停止
    if (realPct.value > simulatedPct.value) { scheduleTick(); return }
    if (maxedOut) { scheduleTick(); return }
    const inc = 1 + Math.random() * 3
    simulatedPct.value = Math.min(95, simulatedPct.value + inc)
    if (simulatedPct.value >= 95) maxedOut = true
    scheduleTick()
  }, 400 + Math.random() * 1200)
}

watch(genStatus, (v) => {
  if (v === 'retrying') {
    // 重试时重置模拟进度，重新开始滚动
    clearTimeout(timer)
    simulatedPct.value = 0
    maxedOut = false
    realPct.value = 0
    scheduleTick()
  }
  if (v === 'done') {
    simulatedPct.value = 100; clearTimeout(timer)
    // 重置加载计数，等待图片渲染和加载
    imgLoadCount.value = 0
    loadedEmitted = false
    // 兜底：如果图片已缓存 @load 同步触发，nextTick+setTimeout 做二次确认
    nextTick(() => {
      setTimeout(() => checkAllLoaded(), 100)
    })
  }
  if (v === 'error') clearTimeout(timer)
})

onMounted(() => {
  settings.loadComfyConfig()
  if (genStatus.value !== 'done' && genStatus.value !== 'error') scheduleTick()
})
onUnmounted(() => clearTimeout(timer))
</script>

<style scoped>
.igb { display: flex; flex-direction: column; gap: 6px; }

.igb-img {
  max-width: min(600px, 70vw); max-height: min(800px, 60vh); width: auto; height: auto;
  border-radius: 20px; cursor: pointer; object-fit: contain;
}

.igb-gen {
  /* width/height 由 genBoxStyle 动态注入，这里提供 fallback */
  width: 320px; height: 320px; max-width: 100%;
  border-radius: 20px; overflow: hidden; position: relative;
  background-color: #8b8b8b2c;
  /* Subtle border for shape definition */
  border: 1px solid rgba(224, 123, 108, 0.08);
  /* Inner depth — avoids the flat cardboard look */
  box-shadow: inset 0 0 80px rgba(224, 123, 108, 0.03);
}

.igb-placeholder {
  width: 100%; height: 100%;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  position: relative; overflow: hidden;
  /* Subtle shimmer sweep across the placeholder */
  background: linear-gradient(
    105deg,
    transparent 40%,
    rgba(255, 255, 255, 0.15) 45%,
    rgba(255, 255, 255, 0.25) 50%,
    rgba(255, 255, 255, 0.15) 55%,
    transparent 60%
  );
  background-size: 200% 100%;
  animation: shimmer 3s ease-in-out infinite;
}
@keyframes shimmer {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

.igb-error { background: #e8e8e8; animation: none; }
.igb-retrying {
  /* 重试中：暖橙色背景提示 */
  background: linear-gradient(
    105deg,
    transparent 40%,
    rgba(240, 160, 64, 0.10) 45%,
    rgba(240, 160, 64, 0.18) 50%,
    rgba(240, 160, 64, 0.10) 55%,
    transparent 60%
  );
  background-size: 200% 100%;
}

.igb-beam {
  position: absolute; inset: 0;
  background: linear-gradient(180deg,
    transparent 0%,
    rgba(224, 123, 108, 0.04) 35%,
    rgba(224, 123, 108, 0.10) 50%,
    rgba(224, 123, 108, 0.04) 65%,
    transparent 100%
  );
  animation: beamScan 3s ease-in-out infinite;
}
@keyframes beamScan {
  0% { transform: translateY(-100%); opacity: 0; }
  20% { opacity: 1; }
  80% { opacity: 1; }
  100% { transform: translateY(100%); opacity: 0; }
}

.igb-ring-container { position: relative; width: 80px; height: 80px; z-index: 1; }
.igb-ring { width: 80px; height: 80px; transform: rotate(-90deg); }
.igb-ring-progress { transition: stroke-dashoffset 0.4s ease; }

.igb-pct {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  font-size: 16px; font-weight: 600; color: var(--accent); z-index: 2;
  /* Subtle text glow for legibility against the gradient */
  text-shadow: 0 1px 4px rgba(255, 255, 255, 0.6);
}
.igb-text {
  margin-top: 12px; font-size: 13px;
  color: var(--text-secondary); z-index: 1;
  letter-spacing: 0.02em;
}

/* 图片不可用占位 */
.igb-missing {
  /* width/height 由 genBoxStyle 动态注入，这里提供 fallback */
  width: 320px; height: 320px; max-width: 100%;
  border-radius: 20px; background: #e8e8e8;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 8px;
}
.igb-missing-icon { font-size: 36px; opacity: 0.5; }
.igb-missing-text { font-size: 13px; color: #999; }
</style>
