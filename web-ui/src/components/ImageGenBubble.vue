<template>
  <div class="igb">
    <!-- Generating / pending overlay (hidden when done) -->
    <div v-if="genStatus !== 'done' && genStatus !== 'error'" class="igb-gen">
      <div class="igb-placeholder">
        <div class="igb-beam"></div>
        <div class="igb-ring-container">
          <svg viewBox="0 0 80 80" class="igb-ring">
            <circle cx="40" cy="40" r="34" fill="none" stroke="rgba(0,0,0,0.06)" stroke-width="3" />
            <circle cx="40" cy="40" r="34" fill="none" stroke="#5b8def"
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
        />
        <div v-else class="igb-missing">
          <div class="igb-missing-icon">🖼️</div>
          <div class="igb-missing-text">图片不可用</div>
        </div>
      </template>
    </template>

    <!-- Error -->
    <div v-if="genStatus === 'error'" class="igb-gen">
      <div class="igb-placeholder igb-error">
        <div style="font-size:36px">⚠️</div>
        <div style="margin-top:8px; font-size:13px; color:#999">生成失败，请重试</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue'

const props = defineProps({ msg: { type: Object, required: true } })
defineEmits(['preview'])

// 跟踪图片加载失败的索引
const imgError = reactive(new Set())
function onImgError(i) { imgError.add(i) }
// 切换消息时重置（历史消息重加载）
watch(() => props.msg.genId, () => imgError.clear())

const circumference = 2 * Math.PI * 34

// 本地 genStatus 副本，避免 props.msg 替换后不更新
const genStatus = ref(props.msg.genStatus || 'pending')
const images = ref(props.msg.images || [])

watch(() => props.msg.genStatus, (v) => { genStatus.value = v })
watch(() => props.msg.images, (v) => { images.value = v || [] })

// ── 真实进度（ComfyUI WebSocket → KSampler step/total）──
const realProgress = ref(props.msg.genProgress ?? 0)
const realTotalSteps = ref(props.msg.genTotalSteps ?? 0)
watch(() => props.msg.genProgress, (v) => { if (v !== undefined) realProgress.value = v })
watch(() => props.msg.genTotalSteps, (v) => { if (v !== undefined) realTotalSteps.value = v })

// ── 模拟进度兜底（提交中 / 等待 WebSocket 阶段）──
const simulatedPct = ref(0)
let timer = null
let maxedOut = false

// 显示百分比：真实进度优先，无真实进度时用模拟
const displayPct = computed(() => {
  if (genStatus.value === 'done') return 100
  if (realProgress.value > 0) return Math.floor(realProgress.value * 100)
  return Math.floor(simulatedPct.value)
})

const dashOffset = computed(() => circumference * (1 - displayPct.value / 100))

const statusText = computed(() => {
  if (genStatus.value === 'pending') return '发送中...'
  if (genStatus.value === 'generating') {
    if (realProgress.value > 0) {
      const pct = Math.floor(realProgress.value * 100)
      if (realTotalSteps.value > 0) return `生成中 ${pct}%（${realTotalSteps.value}步）`
      return `生成中 ${pct}%`
    }
    if (displayPct.value >= 95) return '即将完成...'
    return '生成中...'
  }
  return '发送中...'
})

function scheduleTick() {
  timer = setTimeout(() => {
    if (genStatus.value === 'done') { simulatedPct.value = 100; return }
    if (genStatus.value === 'error') return
    // 真实进度存在时，模拟停止增量（避免覆盖）
    if (realProgress.value > 0) { scheduleTick(); return }
    if (maxedOut) { scheduleTick(); return }
    const inc = 1 + Math.random() * 3
    simulatedPct.value = Math.min(95, simulatedPct.value + inc)
    if (simulatedPct.value >= 95) maxedOut = true
    scheduleTick()
  }, 400 + Math.random() * 1200)
}

watch(genStatus, (v) => {
  if (v === 'done') { simulatedPct.value = 100; clearTimeout(timer) }
  if (v === 'error') clearTimeout(timer)
})

onMounted(() => {
  if (genStatus.value !== 'done' && genStatus.value !== 'error') scheduleTick()
})
onUnmounted(() => clearTimeout(timer))
</script>

<style scoped>
.igb { display: flex; flex-direction: column; gap: 6px; }

.igb-img {
  max-width: 600px; max-height: 800px; width: auto; height: auto;
  border-radius: 20px; cursor: pointer; object-fit: contain;
}

.igb-gen {
  width: 320px; height: 320px;
  border-radius: 20px; overflow: hidden; position: relative;
  background: #d0d0d0;
}

.igb-placeholder {
  width: 100%; height: 100%;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  position: relative; overflow: hidden;
}
.igb-error { background: #e8e8e8; }

.igb-beam {
  position: absolute; inset: 0;
  background: linear-gradient(180deg, transparent 0%, rgba(91,141,239,0.06) 40%, rgba(91,141,239,0.12) 50%, rgba(91,141,239,0.06) 60%, transparent 100%);
  animation: beamScan 2.5s ease-in-out infinite;
}
@keyframes beamScan {
  0% { transform: translateY(-100%); }
  100% { transform: translateY(100%); }
}

.igb-ring-container { position: relative; width: 80px; height: 80px; z-index: 1; }
.igb-ring { width: 80px; height: 80px; transform: rotate(-90deg); }
.igb-ring-progress { transition: stroke-dashoffset 0.4s ease; }

.igb-pct {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  font-size: 16px; font-weight: 600; color: #5b8def; z-index: 2;
}
.igb-text { margin-top: 12px; font-size: 13px; color: #666; z-index: 1; }

/* 图片不可用占位 */
.igb-missing {
  width: 320px; height: 320px;
  border-radius: 20px; background: #e8e8e8;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 8px;
}
.igb-missing-icon { font-size: 36px; opacity: 0.5; }
.igb-missing-text { font-size: 13px; color: #999; }
</style>
