<template>
  <linshe-modal
    :model-value="visible"
    :title="CHANGELOG_TITLE"
    wide
    @update:model-value="onModelUpdate"
  >
    <div class="cl-topline">
      <span class="cl-latest">
        <span class="cl-dot" aria-hidden="true"></span>
        最新 {{ latest?.version || '—' }}
      </span>
      <span class="cl-count">
        {{ entries.length > 1 ? `共 ${entries.length} 个版本，向下滚动可看历史` : '本次更新内容' }}
      </span>
    </div>

    <ol v-if="entries.length" class="cl-list">
      <li
        v-for="(entry, index) in entries"
        :key="entry.version + entry.date + index"
        class="cl-entry"
        :class="{ 'is-latest': index === 0 }"
      >
        <div class="cl-entry-head">
          <span class="cl-ver">{{ entry.version }}</span>
          <time class="cl-date">{{ entry.date }}</time>
        </div>
        <h4 v-if="entry.title" class="cl-entry-title">{{ entry.title }}</h4>
        <p v-if="entry.summary" class="cl-entry-summary">{{ entry.summary }}</p>
        <ul class="cl-items">
          <li v-for="(item, i) in entry.items" :key="i">{{ item }}</li>
        </ul>
      </li>
    </ol>

    <div v-else class="cl-empty">
      <p class="cl-empty-title">还没有写更新说明</p>
      <p class="cl-empty-hint">
        编辑 <code>web-ui/src/data/changelog.js</code> 里的 <code>CHANGELOG_ENTRIES</code>，
        下次执行 <code>npm run tag</code> 时会自动刷新标志位。
      </p>
    </div>

    <template #footer>
      <linshe-button variant="primary" class="cl-ok" @click="close">我知道了</linshe-button>
    </template>
  </linshe-modal>
</template>

<script setup>
/**
 * ChangelogDialog —— 更新说明弹窗
 *
 * 内容全部来自 src/data/changelog.js（手动维护），本组件只负责渲染。
 * 由 App.vue 在「首次启动」或「CHANGELOG_FLAG 变化」时调用 open() 弹出；
 * 用户关闭时 emit('close')，App.vue 据此把当前标志位记进 localStorage，
 * 于是同一个标志位只会弹一次，直到下次更新说明内容变化。
 */
import { computed, ref } from 'vue'
import LinsheModal from './ui/LinsheModal.vue'
import LinsheButton from './ui/LinsheButton.vue'
import { CHANGELOG_ENTRIES, CHANGELOG_TITLE } from '../data/changelog.js'

const emit = defineEmits(['close'])

const visible = ref(false)

/** 容错归一化：容忍缺字段 / items 写成字符串 / entries 不是数组等手滑情况 */
const entries = computed(() => {
  const raw = Array.isArray(CHANGELOG_ENTRIES) ? CHANGELOG_ENTRIES : []
  return raw
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({
      version: String(entry.version ?? '').trim() || '未命名版本',
      date: String(entry.date ?? '').trim(),
      title: String(entry.title ?? '').trim(),
      summary: String(entry.summary ?? '').trim(),
      items: (Array.isArray(entry.items) ? entry.items : [entry.items])
        .filter((item) => item !== null && item !== undefined && String(item).trim() !== '')
        .map((item) => String(item).trim()),
    }))
})

const latest = computed(() => entries.value[0] || null)

function open() {
  visible.value = true
}

function close() {
  if (!visible.value) return
  visible.value = false
  emit('close')
}

// LinsheModal 内部关闭（Esc / 点遮罩 / ✕）会回传 false，统一走 close() 收口
function onModelUpdate(value) {
  if (!value) close()
}

defineExpose({ open, close })
</script>

<style scoped>
/* ── 顶部摘要行 ── */
.cl-topline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}

.cl-latest {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 4px 12px 4px 10px;
  border-radius: 999px;
  background: rgba(var(--accent-rgb), 0.12);
  color: var(--accent-hover);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.cl-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 3px rgba(var(--accent-rgb), 0.18);
}

.cl-count {
  font-size: 12px;
  color: var(--text-secondary);
}

/* ── 条目列表 ── */
.cl-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 18px;
}

.cl-entry {
  position: relative;
  padding: 14px 16px 16px;
  border-radius: 14px;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
}

/* 最新一版：主题色描边 + 左侧色条，一眼看出「这次更新了什么」 */
.cl-entry.is-latest {
  border-color: rgba(var(--accent-rgb), 0.35);
  background: linear-gradient(
    180deg,
    rgba(var(--accent-rgb), 0.07) 0%,
    var(--bg-secondary) 62%
  );
}
.cl-entry.is-latest::before {
  content: '';
  position: absolute;
  left: 0;
  top: 14px;
  bottom: 14px;
  width: 3px;
  border-radius: 0 3px 3px 0;
  background: var(--accent);
}

.cl-entry-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 6px;
}

.cl-ver {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.03em;
  color: var(--accent-hover);
  font-variant-numeric: tabular-nums;
}

.cl-date {
  font-size: 11px;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.cl-entry-title {
  margin: 0 0 4px;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.4;
  color: var(--text-bright);
}

.cl-entry-summary {
  margin: 0 0 10px;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--text-secondary);
}

/* ── 改动条目 ── */
.cl-items {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 8px;
}

.cl-items li {
  position: relative;
  padding-left: 16px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-primary);
}

.cl-items li::before {
  content: '';
  position: absolute;
  left: 2px;
  top: 9px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: rgba(var(--accent-rgb), 0.55);
}

.cl-entry.is-latest .cl-items li::before {
  background: var(--accent);
}

/* ── 空状态 ── */
.cl-empty {
  padding: 26px 18px;
  border-radius: 14px;
  border: 1px dashed var(--border-strong);
  text-align: center;
}

.cl-empty-title {
  margin: 0 0 8px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-bright);
}

.cl-empty-hint {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.8;
  color: var(--text-secondary);
}

.cl-empty-hint code {
  padding: 1px 5px;
  border-radius: 5px;
  background: rgba(var(--accent-rgb), 0.1);
  color: var(--accent-hover);
  font-size: 12px;
}

/* 皮肤交给 LinsheButton，这里只调尺寸 */
.cl-ok {
  min-width: 112px;
  min-height: 38px;
}

@media (max-width: 640px) {
  .cl-entry {
    padding: 12px 13px 14px;
  }
  .cl-topline {
    margin-bottom: 12px;
  }
}
</style>
