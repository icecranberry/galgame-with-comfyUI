<template>
  <div class="emotion-panel" :class="{ collapsed }">
    <div class="emotion-header" @click="collapsed = !collapsed">
      <span class="emotion-label">{{ collapsed ? '📊' : '📊 情绪状态' }}</span>
      <span class="emotion-toggle">{{ collapsed ? '展开' : '收起' }}</span>
    </div>

    <div v-if="!collapsed" class="emotion-body">
      <!-- VAD bars -->
      <div class="vad-row">
        <div class="vad-item">
          <span class="vad-name">愉悦度</span>
          <div class="vad-bar-track">
            <div class="vad-bar" :style="{ width: toPct(emotion.instant.valence, -1, 1) }"></div>
          </div>
          <span class="vad-val">{{ emotion.instant.valence.toFixed(2) }}</span>
        </div>
        <div class="vad-item">
          <span class="vad-name">唤醒度</span>
          <div class="vad-bar-track">
            <div class="vad-bar arousal" :style="{ width: toPct(emotion.instant.arousal, 0, 1) }"></div>
          </div>
          <span class="vad-val">{{ emotion.instant.arousal.toFixed(2) }}</span>
        </div>
        <div class="vad-item">
          <span class="vad-name">支配度</span>
          <div class="vad-bar-track">
            <div class="vad-bar dominance" :style="{ width: toPct(emotion.instant.dominance, 0, 1) }"></div>
          </div>
          <span class="vad-val">{{ emotion.instant.dominance.toFixed(2) }}</span>
        </div>
      </div>

      <!-- Mood baseline -->
      <div class="mood-info" v-if="emotion.mood">
        <span>长期心情:</span>
        <span class="mood-vals">
          V={{ emotion.mood.valence?.toFixed(2) }} A={{ emotion.mood.arousal?.toFixed(2) }} D={{ emotion.mood.dominance?.toFixed(2) }}
        </span>
      </div>

      <!-- Character baseline -->
      <div class="mood-info baseline" v-if="emotion.baseline">
        <span>角色基线:</span>
        <span class="mood-vals">
          V={{ emotion.baseline.valence }} A={{ emotion.baseline.arousal }} D={{ emotion.baseline.dominance }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'

defineProps({
  emotion: { type: Object, required: true },
  character: { type: Object, default: null },
})

const collapsed = ref(true)

function toPct(val, min, max) {
  return ((val - min) / (max - min) * 100).toFixed(0) + '%'
}
</script>

<style scoped>
.emotion-panel {
  background: var(--bg-secondary);
  border-top: 1px solid var(--border);
  font-size: 12px;
}

.emotion-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 24px;
  cursor: pointer;
  user-select: none;
}
.emotion-header:hover { background: var(--bg-hover); }

.emotion-label {
  font-weight: 600;
  color: var(--text-secondary);
}

.emotion-toggle {
  color: var(--text-secondary);
  font-size: 11px;
}

.emotion-body {
  padding: 8px 24px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.vad-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.vad-item {
  display: flex;
  align-items: center;
  gap: 10px;
}

.vad-name {
  width: 48px;
  flex-shrink: 0;
  color: var(--text-secondary);
  font-size: 12px;
}

.vad-bar-track {
  flex: 1;
  height: 6px;
  background: var(--bg-primary);
  border-radius: 3px;
  overflow: hidden;
}

.vad-bar {
  height: 100%;
  background: linear-gradient(90deg, var(--danger), var(--warning), var(--success));
  border-radius: 3px;
  transition: width 0.5s ease;
  min-width: 4px;
}
.vad-bar.arousal {
  background: linear-gradient(90deg, #60a5fa, var(--accent-light));
}
.vad-bar.dominance {
  background: linear-gradient(90deg, #a78bfa, var(--accent));
}

.vad-val {
  width: 40px;
  text-align: right;
  color: var(--text-bright);
  font-family: monospace;
  font-size: 11px;
}

.mood-info {
  display: flex;
  justify-content: space-between;
  color: var(--text-secondary);
  font-size: 11px;
}
.mood-info.baseline {
  opacity: 0.7;
}
.mood-vals {
  font-family: monospace;
}
</style>
