<template>
  <!-- ── 外观特化标签选择器（独立弹窗） ──
       2026-10-06 用户诉求：原内嵌面板在 27 个分组时把角色弹窗内容撑爆（"视觉上很难用"），
       改为独立弹窗 + 搜索 + 分组折叠。

       ★ 内容口径：**只给身体设计类标签**（种族/机械义体/体型身高/阴毛/生理特征）——
         动作、表情、瞬时状态（流口水、乳晕微露、胸部晃动）已移交「绘图」页。
         过滤由后端按唯一真源（appearanceTagPartition）执行，前端不另抄名单。 -->
  <linshe-modal v-model="visibleModel" :title="modalTitle" wide>
    <div class="tp-body">
      <p class="tp-intro">{{ introText }}</p>

      <div class="tp-toolbar">
        <linshe-input
          v-model="query" size="sm" class="tp-search"
          placeholder="搜索标签（中文或英文，如 狐耳 / fox ears / android）"
        />
        <span class="tp-picked-n">已选 {{ picked.length }}</span>
      </div>

      <!-- 已选 -->
      <div v-if="picked.length" class="tp-picked">
        <span v-for="(t, i) in picked" :key="`${t}-${i}`" class="tp-chip">
          {{ t }}
          <button type="button" class="tp-chip-x" :title="`移除 ${t}`" @click="remove(i)">×</button>
        </span>
      </div>

      <!-- 目录 -->
      <div class="tp-catalog">
        <p v-if="loading" class="tp-empty">正在读取标签库…</p>
        <p v-else-if="!filtered.length" class="tp-empty">没有匹配「{{ query }}」的标签</p>
        <template v-else>
          <div v-for="sec in filtered" :key="sec.name" class="tp-sec">
            <div class="tp-sec-head">{{ sec.name }}</div>
            <div v-for="g in sec.groups" :key="`${sec.name}/${g.name}`" class="tp-group">
              <button
                type="button" class="tp-group-head"
                :class="{ open: openGroups.has(`${sec.name}/${g.name}`) || !!query }"
                @click="toggleGroup(`${sec.name}/${g.name}`)"
              >
                <span class="tp-group-name">{{ g.name }}</span>
                <span class="tp-group-n">{{ g.tags.length }}</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"
                  stroke-linecap="round" stroke-linejoin="round" class="tp-caret"><polyline points="6 9 12 15 18 9"/></svg>
              </button>
              <div v-if="openGroups.has(`${sec.name}/${g.name}`) || !!query" class="tp-tags">
                <button
                  v-for="tag in g.tags" :key="tag.tag" type="button"
                  class="tp-tag" :class="{ on: picked.includes(tag.tag) }"
                  :title="tag.tag"
                  @click="toggle(tag.tag)"
                >{{ tag.label || tag.tag }}</button>
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>

    <template #footer>
      <linshe-button variant="ghost" @click="picked = []">清空</linshe-button>
      <linshe-button variant="primary" @click="confirm">确定</linshe-button>
    </template>
  </linshe-modal>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import * as api from '../api/index.js'
// ⚠ Linshe 组件在本项目是**局部 import**（main.js 里没有 app.component 全局注册）。
// 漏 import 不会报错，Vue 会把它当成"未知自定义元素"原样渲染 ——
// 表现为 `linshe-input modelvalue=""` 这种裸标签：没有输入框、没有 footer、点不动。
// （2026-10-07 真机验收抓到过一次，静态测试看不出来。）
import LinsheModal from './ui/LinsheModal.vue'
import LinsheButton from './ui/LinsheButton.vue'
import LinsheInput from './ui/LinsheInput.vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  displayName: { type: String, default: '' },
  /** 当前已选标签（打开时作为初始值） */
  selected: { type: Array, default: () => [] },
  /**
   * 词库档位：
   *  · `body`（默认）＝角色页用，**只给常驻身体特征**（种族/机械义体/体型/生理）；
   *  · `draw` ＝「绘图」页用，给**全量词库**（动作、表情、瞬时状态都在）。
   * 分家判定收口在服务端唯一真源 `appearanceTagPartition.js`，本组件不另抄名单。
   */
  mode: { type: String, default: 'body' },
})
const emit = defineEmits(['update:modelValue', 'confirm'])

const visibleModel = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

const isDraw = computed(() => props.mode === 'draw')
const modalTitle = computed(() =>
  isDraw.value ? '标签库 · 自由组合' : `选择外观特化标签 — ${props.displayName || ''}`
)
const introText = computed(() => isDraw.value
  ? '这是完整词库：动作、表情、瞬时状态、衣着状态都在这里，点选后写进左边的画面描述，可继续手改。'
  : '这些是角色的常驻身体特征（种族、机械义体、体型、生理特征），点选后会写入上方「身体」字段，可继续手改。动作与表情状态（例：流口水、胸部晃动）不在这里，请到「绘图」页自由组合。')

const loading = ref(false)
const catalog = ref([])
const query = ref('')
const picked = ref([])
const openGroups = ref(new Set())

/** 按搜索词过滤（中文标签与英文 tag 都匹配）；命中时自动展开所在组 */
const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return catalog.value
  const out = []
  for (const sec of catalog.value) {
    const groups = []
    for (const g of sec.groups) {
      const tags = g.tags.filter(t =>
        String(t.label || '').toLowerCase().includes(q) || String(t.tag || '').toLowerCase().includes(q))
      if (tags.length) groups.push({ ...g, tags })
    }
    if (groups.length) out.push({ ...sec, groups })
  }
  return out
})

async function loadCatalog() {
  loading.value = true
  try {
    // mode 决定词库档位（body=角色页身体设计类 / draw=绘图页全量）；
    // 过滤在服务端按唯一真源执行，前端不另抄名单。
    const d = await api.getAppearanceTraitCatalog(props.mode)
    catalog.value = Array.isArray(d?.sections) ? d.sections : []
  } catch (err) {
    console.error('[traitPicker] 读取标签库失败:', err)
  } finally {
    loading.value = false
  }
}

/**
 * 全部组默认展开。
 * 2026-10-07 用户诉求：「不需要…全部默认折叠」—— 折叠起来等于要连点 7 次才看得见有什么，
 * 面板本身有 max-height 滚动兜底，全展开不撑爆布局。
 * 搜索态本来就是全展开（`filtered` 只留命中组），这里与之对齐。
 */
function expandAll() {
  const s = new Set()
  for (const sec of catalog.value) {
    for (const g of sec.groups || []) s.add(`${sec.name}/${g.name}`)
  }
  openGroups.value = s
}

watch(() => props.modelValue, async (v) => {
  if (!v) return
  query.value = ''
  picked.value = [...(props.selected || [])]
  await loadCatalog()
  expandAll()
})

// 档位切换（同一实例复用）时重新拉词库 —— 否则会把上一档的内容留在面板里
watch(() => props.mode, async () => {
  if (!props.modelValue) return
  catalog.value = []
  openGroups.value = new Set()
  await loadCatalog()
  expandAll()
})

function toggleGroup(key) {
  const s = new Set(openGroups.value)
  if (s.has(key)) s.delete(key); else s.add(key)
  openGroups.value = s
}

function toggle(tag) {
  const i = picked.value.indexOf(tag)
  if (i >= 0) picked.value.splice(i, 1)
  else picked.value.push(tag)
}

function remove(i) { picked.value.splice(i, 1) }

function confirm() {
  emit('confirm', [...picked.value])
  visibleModel.value = false
}
</script>

<style scoped>
.tp-body { display: flex; flex-direction: column; gap: 10px; min-height: 0; }
.tp-intro { margin: 0; font-size: 12px; line-height: 1.6; color: var(--text-secondary); }
.tp-toolbar { display: flex; align-items: center; gap: 10px; }
.tp-search { flex: 1; min-width: 0; }
.tp-picked-n { font-size: 12px; color: var(--text-secondary); white-space: nowrap; }
.tp-picked { display: flex; flex-wrap: wrap; gap: 6px; }
.tp-chip {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 6px 3px 9px; border-radius: 999px; font-size: 11px;
  background: rgba(var(--accent-rgb), 0.14); color: var(--text-primary);
  border: 1px solid rgba(var(--accent-rgb), 0.32);
}
.tp-chip-x {
  border: 0; background: transparent; cursor: pointer; padding: 0 2px;
  font-size: 13px; line-height: 1; color: var(--text-secondary);
}
.tp-chip-x:hover { color: var(--text-primary); }
.tp-catalog {
  flex: 1; min-height: 220px; max-height: 46vh; overflow-y: auto;
  border: 1px solid var(--border-color, rgba(0,0,0,0.1)); border-radius: 10px; padding: 8px;
}
.tp-empty { margin: 0; padding: 18px 4px; font-size: 12px; color: var(--text-tertiary); text-align: center; }
.tp-sec-head { font-size: 12px; font-weight: 500; color: var(--text-secondary); padding: 6px 4px 2px; }
.tp-group { border-bottom: 1px solid var(--border-color, rgba(0,0,0,0.06)); }
.tp-group:last-child { border-bottom: 0; }
.tp-group-head {
  width: 100%; display: flex; align-items: center; gap: 8px;
  padding: 7px 4px; border: 0; background: transparent; cursor: pointer;
  font-size: 12px; color: var(--text-primary); text-align: left;
}
.tp-group-head:hover { background: var(--bg-tertiary, rgba(0,0,0,0.03)); border-radius: 6px; }
.tp-group-name { flex: 1; }
.tp-group-n { font-size: 11px; color: var(--text-tertiary); }
.tp-caret { color: var(--text-tertiary); transition: transform 0.15s; }
.tp-group-head.open .tp-caret { transform: rotate(180deg); }
.tp-tags { display: flex; flex-wrap: wrap; gap: 5px; padding: 2px 4px 10px; }
.tp-tag {
  padding: 3px 8px; border-radius: 6px; font-size: 11px; cursor: pointer;
  border: 1px solid var(--border-color, rgba(0,0,0,0.12));
  background: var(--bg-secondary, transparent); color: var(--text-primary);
}
.tp-tag:hover { border-color: rgba(var(--accent-rgb), 0.5); }
.tp-tag.on {
  background: var(--accent-solid); color: var(--on-accent);
  border-color: var(--accent-solid);
}
</style>