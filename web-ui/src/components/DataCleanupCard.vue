<template>
  <div class="card cleanup-card">
    <h3>数据清理</h3>
    <p class="fd">
      按时间清理<b>生成的图片</b>与<b>内容记录</b>。先选天数 → 点「扫描」看会删掉什么 → 确认后再执行。
      <b>执行前会自动备份数据库</b>（记录删了回不来，但整库可回滚）。
    </p>

    <!-- 天数档位 -->
    <div class="cl-days">
      <span class="cl-days-label">清理</span>
      <button
        v-for="d in DAY_PRESETS"
        :key="d"
        type="button"
        class="cl-day"
        :class="{ on: days === d }"
        :disabled="busy"
        @click="pickDays(d)"
      >{{ d }} 天前</button>
      <div class="cl-custom">
        <linshe-input
          v-model.number="customDays"
          class="fi cl-custom-input"
          size="sm"
          type="number"
          :disabled="busy"
          @keyup.enter="pickDays(customDays)"
        />
        <linshe-button size="sm" variant="secondary" :disabled="busy" @click="pickDays(customDays)">自定义</linshe-button>
      </div>
    </div>

    <div class="cl-bar">
      <linshe-button variant="secondary" :loading="scanning" :disabled="busy" @click="scan">
        {{ survey ? '重新扫描' : '扫描' }}
      </linshe-button>
      <span v-if="survey" class="cl-cutoff">截止 {{ survey.cutoff }}（早于此时刻的数据）</span>
    </div>

    <!-- 扫描结果 -->
    <template v-if="survey">
      <div v-if="!survey.total.rows && !survey.total.files" class="cl-none">
        这段时间之前没有可清理的数据。
      </div>

      <template v-else>
        <!-- 内容记录 -->
        <div class="cl-group">
          <div class="cl-group-head">
            <span class="cl-group-title">内容记录</span>
            <span class="cl-group-sum">{{ fmt(survey.contentTotal) }}</span>
            <button type="button" class="cl-all" @click="toggleGroup('content')">
              {{ allChecked('content') ? '取消全选' : '全选' }}
            </button>
          </div>
          <label v-for="t in contentTargets" :key="t.key" class="cl-row" :class="{ 'is-empty': !t.rows && !t.files }">
            <input type="checkbox" v-model="checked[t.key]" :disabled="busy || (!t.rows && !t.files)" />
            <span class="cl-row-main">
              <span class="cl-row-label">{{ t.label }}</span>
              <span class="cl-row-desc">{{ t.desc }}</span>
            </span>
            <span class="cl-row-num">{{ fmt(t) }}</span>
          </label>
        </div>

        <!-- 长期资产 -->
        <div class="cl-group is-asset">
          <div class="cl-group-head">
            <span class="cl-group-title">长期资产（删了会影响功能）</span>
            <span class="cl-group-sum">{{ fmt(survey.assetTotal) }}</span>
            <button type="button" class="cl-all" @click="toggleGroup('asset')">
              {{ allChecked('asset') ? '取消全选' : '全选' }}
            </button>
          </div>
          <div class="cl-warn">这些不是「历史」，而是<b>当前正在用的资源</b>。默认不勾选 —— 勾了才会删。</div>
          <label v-for="t in assetTargets" :key="t.key" class="cl-row" :class="{ 'is-empty': !t.rows && !t.files }">
            <input type="checkbox" v-model="checked[t.key]" :disabled="busy || (!t.rows && !t.files)" />
            <span class="cl-row-main">
              <span class="cl-row-label">{{ t.label }}</span>
              <span class="cl-row-desc">{{ t.desc }}</span>
            </span>
            <span class="cl-row-num">{{ fmt(t) }}</span>
          </label>
        </div>

        <!-- 保护集说明 -->
        <div v-if="protectedTotal" class="cl-protect">
          已自动保护 <b>{{ protectedTotal }}</b> 个「仍被现存记录引用」的图片 —— 它们不会被删，
          否则会出现「新消息的配图变 404」。
        </div>

        <!-- 执行 -->
        <div class="cl-actions">
          <span class="cl-picked">已选 {{ pickedKeys.length }} 项 · 将删除 {{ fmt(pickedTotal) }}</span>
          <div style="flex:1"></div>
          <linshe-button
            variant="danger"
            :disabled="!pickedKeys.length || busy"
            :loading="purging"
            @click="confirmOpen = true"
          >执行清理</linshe-button>
        </div>
      </template>
    </template>

    <!-- 执行确认 -->
    <linshe-modal :visible="confirmOpen" title="确认清理" @close="confirmOpen = false">
      <div class="cl-confirm">
        <p class="cl-confirm-lead">
          即将删除 <b>{{ fmt(pickedTotal) }}</b>（{{ days }} 天前）：
        </p>
        <ul class="cl-confirm-list">
          <li v-for="t in pickedTargets" :key="t.key">
            {{ t.label }} —— <b>{{ fmt(t) }}</b>
          </li>
        </ul>

        <p class="cl-confirm-note">
          执行前会自动备份数据库到 <code>data/backups/</code>。
          <b>但图片文件删除后无法通过备份恢复</b>（备份只含数据库）。请确认无误。
        </p>
        <p class="cl-confirm-note">请输入 <b>{{ CONFIRM_WORD }}</b> 以确认：</p>
        <linshe-input v-model="confirmText" class="fi" :placeholder="CONFIRM_WORD" @keyup.enter="runPurge" />
      </div>
      <template #footer>
        <div style="flex:1"></div>
        <linshe-button variant="secondary" @click="confirmOpen = false">取消</linshe-button>
        <linshe-button
          variant="danger"
          :disabled="confirmText.trim() !== CONFIRM_WORD"
          :loading="purging"
          @click="runPurge"
        >确认删除</linshe-button>
      </template>
    </linshe-modal>

    <!-- 结果 -->
    <div v-if="lastResult" class="cl-result">
      <div class="cl-result-title">上次清理（{{ lastResult.days }} 天前）</div>
      <div class="cl-result-body">
        删除记录 <b>{{ lastResult.totalRows }}</b> 行 · 图片 <b>{{ lastResult.totalFiles }}</b> 个 · 释放 <b>{{ fmtBytes(lastResult.totalBytes) }}</b>
      </div>
      <div v-if="lastResult.backup" class="cl-result-backup">
        备份：{{ lastResult.backup.path?.split(/[\\/]/).pop() }}
        <span v-if="lastResult.backup.verified" class="cl-ok">已校验</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted, inject } from 'vue'
import * as api from '../api/index.js'
import LinsheButton from './ui/LinsheButton.vue'
import LinsheInput from './ui/LinsheInput.vue'
import LinsheModal from './ui/LinsheModal.vue'

const toastFn = inject('toast')
const DAY_PRESETS = [7, 14, 30]
/** 执行确认词：防手滑，也逼用户看一眼确认框内容 */
const CONFIRM_WORD = '确认删除'

const days = ref(7)
const customDays = ref(60)
const survey = ref(null)
const scanning = ref(false)
const purging = ref(false)
const confirmOpen = ref(false)
const confirmText = ref('')
const lastResult = ref(null)
const checked = reactive({})

const busy = computed(() => scanning.value || purging.value)
const contentTargets = computed(() => (survey.value?.targets || []).filter(t => t.group === 'content'))
const assetTargets = computed(() => (survey.value?.targets || []).filter(t => t.group === 'asset'))

const pickedKeys = computed(() => Object.keys(checked).filter(k => checked[k]))
const pickedTargets = computed(() => (survey.value?.targets || []).filter(t => checked[t.key]))
const pickedTotal = computed(() => pickedTargets.value.reduce((a, t) => ({
  rows: a.rows + t.rows, files: a.files + t.files, bytes: a.bytes + t.bytes,
}), { rows: 0, files: 0, bytes: 0 }))

const protectedTotal = computed(() => (survey.value?.targets || []).reduce((a, t) => a + (t.skippedProtected || 0), 0))

function fmtBytes(b) {
  const v = Number(b) || 0
  if (v >= 1073741824) return (v / 1073741824).toFixed(2) + ' GB'
  if (v >= 1048576) return (v / 1048576).toFixed(0) + ' MB'
  if (v >= 1024) return (v / 1024).toFixed(0) + ' KB'
  return v + ' B'
}
function fmt(t) {
  const parts = []
  if (t.rows) parts.push(`${t.rows} 行`)
  if (t.files) parts.push(`${t.files} 图`)
  if (t.bytes) parts.push(fmtBytes(t.bytes))
  return parts.length ? parts.join(' · ') : '—'
}

function allChecked(group) {
  const list = (group === 'content' ? contentTargets.value : assetTargets.value)
    .filter(t => t.rows || t.files)
  return list.length > 0 && list.every(t => checked[t.key])
}
function toggleGroup(group) {
  const list = (group === 'content' ? contentTargets.value : assetTargets.value)
    .filter(t => t.rows || t.files)
  const to = !allChecked(group)
  for (const t of list) checked[t.key] = to
}

function pickDays(d) {
  const n = Number(d)
  if (!Number.isFinite(n) || n < 1) return
  days.value = Math.floor(n)
  survey.value = null
  scan()
}

async function scan() {
  if (busy.value) return
  scanning.value = true
  try {
    const d = await api.surveyCleanup(days.value)
    survey.value = d
    // 默认只勾「有存量」的内容记录项；长期资产一律不勾
    for (const k of Object.keys(checked)) delete checked[k]
    for (const t of d.targets) {
      checked[t.key] = t.group === 'content' && (t.rows > 0 || t.files > 0)
    }
  } catch (err) {
    const hint = /404/.test(err?.message || '') ? '（后端未重启，新接口还没生效）' : ''
    toastFn?.('扫描失败' + hint + '：' + (err?.message || ''), 'error')
  } finally {
    scanning.value = false
  }
}

async function runPurge() {
  if (confirmText.value.trim() !== CONFIRM_WORD || !pickedKeys.value.length) return
  purging.value = true
  try {
    const r = await api.purgeCleanup({ days: days.value, targets: pickedKeys.value })
    lastResult.value = r
    toastFn?.(`已删除 ${r.totalRows} 行记录、${r.totalFiles} 个图片，释放 ${fmtBytes(r.totalBytes)}`, 'success')
    confirmOpen.value = false
    confirmText.value = ''
    await scan()   // 重新扫描，反映清理后的状态
  } catch (err) {
    toastFn?.('清理失败：' + (err?.message || ''), 'error')
  } finally {
    purging.value = false
  }
}

onMounted(() => { scan() })
</script>

<style scoped>
.cleanup-card { display: flex; flex-direction: column; gap: 10px; }

/* ── 天数档位 ── */
.cl-days { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.cl-days-label { font-size: 13px; font-weight: 600; color: var(--text-bright); margin-right: 2px; }
.cl-day {
  padding: 5px 12px; border-radius: 999px;
  border: 1px solid var(--glass-border);
  background: var(--bg-tertiary); color: var(--text-secondary);
  font-family: inherit; font-size: 12px; font-weight: 600;
  cursor: pointer; transition: all 0.15s;
}
.cl-day:hover:not(:disabled) { color: var(--text-primary); }
.cl-day.on { background: rgba(var(--accent-rgb), 0.12); border-color: var(--accent); color: var(--accent); }
.cl-day:disabled { opacity: 0.5; cursor: default; }
.cl-custom { display: flex; align-items: center; gap: 6px; margin-left: 4px; }
.cl-custom-input { width: 76px; }

.cl-bar { display: flex; align-items: center; gap: 10px; }
.cl-cutoff { font-size: 11px; color: var(--text-secondary); }

.cl-none {
  padding: 16px; text-align: center; font-size: 12px; color: var(--text-secondary);
  background: var(--bg-tertiary); border-radius: 10px;
}

/* ── 分组 ── */
.cl-group {
  display: flex; flex-direction: column; gap: 2px;
  padding: 10px 12px; border-radius: 12px;
  background: var(--bg-tertiary);
  border: 1px solid var(--glass-border);
}
.cl-group.is-asset { border-color: rgba(var(--accent-rgb), 0.28); }
.cl-group-head { display: flex; align-items: baseline; gap: 8px; padding-bottom: 6px; }
.cl-group-title { font-size: 12px; font-weight: 600; color: var(--text-bright); }
.cl-group-sum { font-size: 11px; color: var(--accent); font-weight: 600; }
.cl-all {
  margin-left: auto; border: none; background: none; cursor: pointer;
  font-family: inherit; font-size: 11px; font-weight: 600;
  color: var(--accent); padding: 2px 6px; border-radius: 6px;
}
.cl-all:hover { background: rgba(var(--accent-rgb), 0.1); }
.cl-warn {
  font-size: 11px; line-height: 1.6; color: var(--text-secondary);
  padding: 6px 8px; margin-bottom: 4px;
  border-radius: 8px; background: rgba(var(--accent-rgb), 0.06);
}
.cl-warn b { color: var(--text-primary); }

.cl-row {
  display: flex; align-items: flex-start; gap: 9px;
  padding: 6px 8px; border-radius: 8px;
  cursor: pointer; transition: background 0.15s;
}
.cl-row:hover:not(.is-empty) { background: rgba(var(--accent-rgb), 0.05); }
.cl-row.is-empty { opacity: 0.45; cursor: default; }
.cl-row input { margin-top: 2px; flex-shrink: 0; accent-color: var(--accent); }
.cl-row-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.cl-row-label { font-size: 12px; font-weight: 600; color: var(--text-primary); }
.cl-row-desc { font-size: 11px; color: var(--text-secondary); line-height: 1.5; }
.cl-row-num { flex-shrink: 0; font-size: 11px; color: var(--accent); font-weight: 600; white-space: nowrap; padding-top: 1px; }

.cl-protect {
  font-size: 11px; line-height: 1.6; color: var(--text-secondary);
  padding: 8px 10px; border-radius: 8px;
  background: rgba(80, 160, 100, 0.08);
  border: 1px solid rgba(80, 160, 100, 0.22);
}
.cl-protect b { color: var(--success, #3f9c5a); }

.cl-actions { display: flex; align-items: center; gap: 10px; margin-top: 4px; }
.cl-picked { font-size: 12px; color: var(--text-secondary); }
.cl-picked b, .cl-picked { }

/* ── 确认框 ── */
.cl-confirm { display: flex; flex-direction: column; gap: 10px; }
.cl-confirm-lead { margin: 0; font-size: 13px; color: var(--text-primary); }
.cl-confirm-list { margin: 0; padding-left: 20px; font-size: 12px; color: var(--text-secondary); line-height: 1.9; }
.cl-confirm-list b { color: var(--accent); }
.cl-confirm-note { margin: 0; font-size: 12px; line-height: 1.7; color: var(--text-secondary); }
.cl-confirm-note b { color: var(--text-primary); }
.cl-confirm-note code { font-size: 11px; background: var(--bg-tertiary); padding: 1px 5px; border-radius: 4px; }

/* ── 结果 ── */
.cl-result {
  display: flex; flex-direction: column; gap: 3px;
  padding: 10px 12px; border-radius: 10px;
  background: rgba(80, 160, 100, 0.08);
  border: 1px solid rgba(80, 160, 100, 0.2);
}
.cl-result-title { font-size: 12px; font-weight: 600; color: var(--text-bright); }
.cl-result-body { font-size: 12px; color: var(--text-secondary); }
.cl-result-body b { color: var(--text-primary); }
.cl-result-backup { font-size: 11px; color: var(--text-secondary); }
.cl-ok { margin-left: 6px; color: var(--success, #3f9c5a); font-weight: 600; }

@media (max-width: 767px) {
  .cl-row-desc { display: none; }
  .cl-actions { flex-wrap: wrap; }
}
</style>
