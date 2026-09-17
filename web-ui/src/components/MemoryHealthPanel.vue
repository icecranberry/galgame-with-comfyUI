<template>
  <section class="memory-health" :class="[`lv-${level}`, { 'is-compact': mode === 'compact' }]">
    <div class="mh-head">
      <span class="mh-dot" aria-hidden="true" />
      <div class="mh-headline">
        <strong>{{ headline }}</strong>
        <span v-if="subline" class="mh-sub">{{ subline }}</span>
      </div>
      <linshe-button variant="ghost" size="sm" :loading="loading" @click="load()">刷新</linshe-button>
    </div>

    <!-- 生效态摘要：让"当前到底用的是哪套配置"一眼可见 -->
    <div v-if="health && mode !== 'compact'" class="mh-chips">
      <span class="mh-chip" :class="{ bad: !health.llm.ready }">
        对话模型：{{ health.llm.ready ? (health.llm.freeEgg ? '免费鸡蛋' : '已配置') : '未配置' }}
      </span>
      <span class="mh-chip">智能匹配：{{ health.embedding.label }}</span>
      <span class="mh-chip">结果排序：{{ rerankerLabel }}</span>
      <span class="mh-chip" :class="{ bad: !health.vectorService.reachable }">
        向量服务：{{ health.vectorService.reachable ? '正常' : '不可达' }}
      </span>
      <span class="mh-chip">在用记忆：{{ health.counts.active }} 条</span>
      <span class="mh-chip" :class="{ bad: health.counts.embeddingFailed > 0 }">
        索引失败：{{ health.counts.embeddingFailed }}
      </span>
      <span class="mh-chip">{{ consolidationLabel }}</span>
    </div>

    <ul v-if="mode !== 'compact' && issues.length" class="mh-issues">
      <li v-for="issue in issues" :key="issue.code" :class="`is-${issue.level}`">
        <span class="mh-issue-title">{{ issue.title }}</span>
        <span class="mh-issue-detail">{{ issue.detail }}</span>
        <span v-if="issue.where" class="mh-issue-where">处置：{{ issue.where }}</span>
      </li>
    </ul>
    <p v-else-if="mode !== 'compact' && health" class="mh-ok">各环节都已就绪，记忆可以正常写入、整理与召回。</p>

    <p v-if="error" class="mh-error">{{ error }}</p>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import LinsheButton from './ui/LinsheButton.vue'
import { getMemoryHealth } from '../api/index.js'

const props = defineProps({
  // full：设置页详情（摘要 + 问题清单）；compact：设置入口卡片（仅结论一行）
  mode: { type: String, default: 'full' },
})

const health = ref(null)
const loading = ref(false)
const error = ref('')

const issues = computed(() => health.value?.issues || [])
const level = computed(() => {
  if (error.value) return 'error'
  if (!health.value) return 'loading'
  return health.value.level
})

const headline = computed(() => {
  if (error.value) return '读不到记忆配置'
  if (!health.value) return '正在检查记忆配置…'
  const map = {
    ok: '记忆运行正常',
    off: '记忆系统已关闭',
    warn: '记忆已开启，但有配置需要处理',
    error: '记忆已开启，但有环节没配好',
  }
  return map[health.value.level] || '记忆状态未知'
})

const subline = computed(() => issues.value[0]?.title || '')

const rerankerLabel = computed(() => {
  if (!health.value) return '—'
  if (health.value.reranker.customConfigured) return '自定义模型'
  return health.value.reranker.useBuiltin ? '内置默认' : '本地排序'
})

const consolidationLabel = computed(() => {
  if (!health.value) return '—'
  if (!health.value.consolidation.hasState) return '整理：尚未跑过'
  const at = formatTime(health.value.consolidation.lastWorkedAt || health.value.consolidation.updatedAt)
  return `整理：${at || '尚未跑过'}`
})

function formatTime(value) {
  if (!value) return ''
  const iso = String(value).includes('T') ? value : `${String(value).replace(' ', 'T')}Z`
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

async function load() {
  loading.value = true
  error.value = ''
  try {
    health.value = await getMemoryHealth()
  } catch (err) {
    error.value = err?.message || '记忆体检请求失败'
  } finally {
    loading.value = false
  }
}

defineExpose({ load })
onMounted(load)
</script>

<style scoped>
.memory-health {
  --mh-tone: var(--fun-teal);
  border: 2px solid var(--border);
  border-left: 6px solid var(--mh-tone);
  border-radius: var(--radius-md);
  background: #fff;
  box-shadow: var(--shadow-hard-sm, 0 2px 0 rgba(55, 48, 107, 0.13));
  padding: 12px 14px;
}
.memory-health.lv-ok { --mh-tone: var(--success, #3fbf7f); }
.memory-health.lv-warn { --mh-tone: var(--warning, #faad14); }
.memory-health.lv-error { --mh-tone: var(--danger, #ff4d5f); }
.memory-health.lv-off { --mh-tone: var(--fun-neutral); }
.memory-health.lv-loading { --mh-tone: var(--accent-light, #a99df2); }
.memory-health.is-compact { padding: 10px 12px; }

.mh-head { display: flex; align-items: center; gap: 10px; }
.mh-dot {
  flex: none;
  width: 10px; height: 10px; border-radius: 50%;
  background: var(--mh-tone);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--mh-tone) 20%, transparent);
}
.mh-headline { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.mh-headline strong { font-size: 13.5px; color: var(--text-primary); }
.mh-sub {
  font-size: 12px; color: var(--text-secondary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.mh-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.mh-chip {
  font-size: 11.5px;
  border: 1px solid var(--border);
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  border-radius: var(--radius-full);
  padding: 2px 10px;
  white-space: nowrap;
}
.mh-chip.bad {
  border-color: color-mix(in srgb, var(--danger) 35%, transparent);
  background: color-mix(in srgb, var(--danger) 10%, #fff);
  color: var(--danger);
}

.mh-issues { list-style: none; margin: 11px 0 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.mh-issues li {
  border-radius: var(--radius-sm);
  padding: 8px 11px;
  background: var(--bg-tertiary);
  border-left: 3px solid var(--fun-neutral);
  display: flex; flex-direction: column; gap: 3px;
}
.mh-issues li.is-error { background: color-mix(in srgb, var(--danger) 8%, #fff); border-left-color: var(--danger); }
.mh-issues li.is-warn { background: color-mix(in srgb, var(--warning) 10%, #fff); border-left-color: var(--warning); }
.mh-issues li.is-info { background: color-mix(in srgb, var(--fun-blue) 8%, #fff); border-left-color: var(--fun-blue); }
.mh-issue-title { font-size: 12.8px; font-weight: 700; color: var(--text-primary); }
.mh-issue-detail { font-size: 12.3px; color: var(--text-secondary); line-height: 1.6; }
.mh-issue-where { font-size: 11.8px; color: var(--accent); font-weight: 600; }

.mh-ok { margin: 10px 0 0; font-size: 12.4px; color: var(--text-secondary); }
.mh-error { margin: 10px 0 0; font-size: 12.4px; color: var(--danger); }
</style>
