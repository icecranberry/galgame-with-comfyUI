<template>
  <!-- ── 可检索多选（2026-10-07 用户要求）──────────────────────
       用户口径：「涉及角色和涉及地点我建议改为可输入并自动检索的选择框」。

       ── 与 ui/LinsheSelect.vue 的关系 ────────────────────────
       那一个是**单选**（含自由输入）。本组件是它的**多选**对偶：
       同样的模糊检索口径、同样的浮层样式，但选中项以 chip 形式留在框内，可连续添加。
       ⚠ 两者必须保持同一套检索手感 —— 改匹配算法时请一并看 `LinsheSelect.fuzzyScore`。

       ── 两条设计决定 ──────────────────────────────────────
       ① **允许自由输入**（`allowFreeInput` 默认 true）：地点可能还没被录进地图，
          强行只让选候选会让用户"选不了想要的地点"（红线 0：不能静默丢输入）。
          不在候选里的值也保留，只是标一个「未收录」提示。
       ② **候选里已选的项要从下拉里去掉**（避免重复添加同一个人/地点）。 -->
  <div ref="wrapper" class="mps" :class="{ 'is-disabled': disabled }">
    <div class="mps-box" :class="{ 'is-open': open }" @click="focusInput">
      <span v-for="(item, i) in modelValue" :key="`${item}-${i}`" class="mps-chip">
        <span class="mps-chip-text" :title="displayOf(item)">{{ displayOf(item) }}</span>
        <button
          type="button" class="mps-chip-x" :aria-label="`移除 ${displayOf(item)}`" :disabled="disabled"
          @click.stop="removeAt(i)"
        >×</button>
      </span>

      <input
        ref="input"
        v-model="query"
        class="mps-input"
        type="text"
        role="combobox"
        aria-autocomplete="list"
        :aria-label="ariaLabel || placeholder"
        :aria-expanded="open"
        :placeholder="modelValue.length ? '' : placeholder"
        :disabled="disabled"
        autocomplete="off"
        @focus="onFocus"
        @input="onInput"
        @keydown="onKey"
        @blur="onBlur"
      />
    </div>

    <Teleport to="body">
      <Transition name="mps-drop">
        <div
          v-if="open"
          ref="panel"
          class="mps-dropdown"
          :class="{ up: isUp }"
          :style="panelStyle"
          role="listbox"
          @mousedown.prevent
        >
          <div
            v-for="(opt, index) in visible"
            :key="opt.value"
            class="mps-option"
            :class="{ highlighted: index === activeIndex }"
            role="option"
            :aria-selected="false"
            @mouseenter="activeIndex = index"
            @click="pick(opt)"
          >
            <span class="mps-option-label">{{ opt.label }}</span>
            <span v-if="opt.hint" class="mps-option-hint">{{ opt.hint }}</span>
          </div>

          <!-- 自由输入项：查询词不在候选中时，允许"就用这个词" -->
          <div
            v-if="freeCandidate"
            class="mps-option mps-option-free"
            :class="{ highlighted: activeIndex === visible.length }"
            role="option"
            @mouseenter="activeIndex = visible.length"
            @click="pickFree"
          >
            <span class="mps-option-label">就用「{{ query.trim() }}」</span>
            <span class="mps-option-hint">未收录</span>
          </div>

          <div v-if="!visible.length && !freeCandidate" class="mps-empty">
            {{ candidates.length ? '没有匹配的选项' : '暂无可选项' }}
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup>
import { ref, computed, nextTick, onMounted, onUnmounted, watch } from 'vue'
// ⚠ 检索口径抽在 utils 里（可单测），**不要在这里再写一份 fuzzyScore** ——
//   它同时被 LinsheSelect 的单选交互参照，两处必须同源。
import { rankCandidates, shouldOfferFreeValue, canAddMore, labelOfValue } from '../../utils/multiPickSearch.js'

defineOptions({ name: 'MultiPickSelect' })

/**
 * @typedef {{value:string, label:string, hint?:string}} PickOption
 */
const props = defineProps({
  /** 已选值（字符串数组） */
  modelValue: { type: Array, default: () => [] },
  /** 候选：`{value,label,hint}`。hint 用于显示归属（如"大地区 · 子地区"） */
  candidates: { type: Array, default: () => [] },
  placeholder: { type: String, default: '输入以检索…' },
  disabled: { type: Boolean, default: false },
  /** 允许用不在候选里的自由值（地点未收录时必须允许，否则用户选不了想要的地点） */
  allowFreeInput: { type: Boolean, default: true },
  /** 最多可选数量（0 = 不限） */
  max: { type: Number, default: 0 },
  ariaLabel: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue'])

const DROP_GAP = 4
const DROP_MAX_HEIGHT = 240

const wrapper = ref(null)
const input = ref(null)
const panel = ref(null)
const open = ref(false)
const query = ref('')
const activeIndex = ref(-1)
const isUp = ref(false)
const panelStyle = ref({})

const selected = computed(() => (Array.isArray(props.modelValue) ? props.modelValue : []))
const selectedSet = computed(() => new Set(selected.value.map(String)))

/** 候选中去掉已选项（避免重复添加） */
const visible = computed(() => rankCandidates(props.candidates, query.value, selectedSet.value, 50))

/** 自由输入项只在"确实没匹配上"时出现，避免和现有候选抢位置 */
const freeCandidate = computed(() => shouldOfferFreeValue(
  query.value, visible.value, selectedSet.value, props.allowFreeInput,
))

const canAdd = computed(() => canAddMore(selected.value, props.max))

/**
 * 已选项的**显示名**。
 *
 * ★★ 为什么必须有这个：`value` 与 `label` 不一定相同 —— 角色多选的值是 **id**
 *   （落库要 id），但用户看到 id 完全没法用（实测踩过：chip 直接显示了 `100394`）。
 *   有匹配候选就显示其 label；没有（自由输入 / 角色已被删或归档）就原样显示值。
 */
function displayOf(value) {
  return labelOfValue(props.candidates, value)
}

watch(open, v => {
  if (v) {
    nextTick(positionPanel)
    document.addEventListener('scroll', positionPanel, true)
    document.addEventListener('resize', positionPanel)
  } else {
    document.removeEventListener('scroll', positionPanel, true)
    document.removeEventListener('resize', positionPanel)
  }
})
onUnmounted(() => {
  document.removeEventListener('scroll', positionPanel, true)
  document.removeEventListener('resize', positionPanel)
  document.removeEventListener('click', onDocClick, true)
})

/** 浮层跟随触发框定位；下方空间不足时向上翻转（与 LinsheSelect 同一策略） */
function positionPanel() {
  const el = wrapper.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  const wanted = Math.min(panel.value?.offsetHeight || DROP_MAX_HEIGHT, DROP_MAX_HEIGHT)
  const spaceBelow = window.innerHeight - rect.bottom - DROP_GAP
  const spaceAbove = rect.top - DROP_GAP
  isUp.value = spaceBelow < wanted && spaceAbove > spaceBelow
  panelStyle.value = {
    left: `${Math.round(rect.left)}px`,
    width: `${Math.round(rect.width)}px`,
    ...(isUp.value
      ? { bottom: `${Math.round(window.innerHeight - rect.top + DROP_GAP)}px` }
      : { top: `${Math.round(rect.bottom + DROP_GAP)}px` }),
  }
}

function focusInput() { if (!props.disabled) input.value?.focus() }
function onFocus() { if (!props.disabled) { open.value = true; activeIndex.value = -1 } }
function onInput() { open.value = true; activeIndex.value = -1; nextTick(positionPanel) }
function onBlur() { /* 收起交给 onDocClick，避免点击选项前就关掉 */ }

function addValue(v) {
  const val = String(v ?? '').trim()
  if (!val || !canAdd.value) return
  if (selectedSet.value.has(val)) { query.value = ''; return }
  emit('update:modelValue', [...selected.value, val])
  query.value = ''
  activeIndex.value = -1
  // ⚠ 注意不要在这里 `input.focus()` —— 那会触发 onFocus 把面板重新弹开。
  //   面板**盖在表单字段上**，选中一条后还开着会挡住后面的字段（实测截图确认过）。
  //   用完即关，要再加就再点输入框。
  open.value = false
}

function pick(opt) { addValue(opt.value) }
function pickFree() { addValue(query.value) }
function removeAt(i) {
  const next = selected.value.slice()
  next.splice(i, 1)
  emit('update:modelValue', next)
}

function onKey(e) {
  const total = visible.value.length + (freeCandidate.value ? 1 : 0)
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault()
    if (!open.value) open.value = true
    if (!total) return
    const step = e.key === 'ArrowDown' ? 1 : -1
    activeIndex.value = (activeIndex.value + step + total) % total
  } else if (e.key === 'Enter') {
    e.preventDefault()
    if (activeIndex.value >= 0 && activeIndex.value < visible.value.length) pick(visible.value[activeIndex.value])
    else if (activeIndex.value === visible.value.length && freeCandidate.value) pickFree()
    else if (visible.value.length === 1) pick(visible.value[0])
    else if (freeCandidate.value) pickFree()
  } else if (e.key === 'Backspace' && !query.value && selected.value.length) {
    removeAt(selected.value.length - 1)
  } else if (e.key === 'Escape' && open.value) {
    e.stopPropagation()
    open.value = false
  } else if (e.key === ',' || e.key === '，') {
    // 顿号/逗号 = 快速确认当前输入（用户从旧的"逗号分隔"习惯迁移过来时更顺手）
    if (query.value.trim()) { e.preventDefault(); addValue(query.value) }
  }
}

function onDocClick(e) {
  if (wrapper.value?.contains(e.target)) return
  if (panel.value?.contains(e.target)) return
  open.value = false
}

onMounted(() => document.addEventListener('click', onDocClick, true))

defineExpose({ focus: focusInput })
</script>

<style scoped>
/* 外观与 LinsheSelect / LinsheInput 同一皮肤（凹痕框 + 珊瑚聚焦） */
.mps { position: relative; width: 100%; }
.mps-box {
  box-sizing: border-box;
  display: flex; flex-wrap: wrap; align-items: center; gap: 5px;
  width: 100%; min-height: 36px; padding: 5px 9px;
  background: var(--bg-secondary);
  border: 1.5px solid var(--border);
  border-radius: 10px;
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.05);
  cursor: text;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.mps-box:hover { border-color: var(--border-strong); }
.mps-box.is-open {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(var(--accent-rgb), 0.14), inset 0 1px 0 rgba(255, 255, 255, 0.8);
}
.mps.is-disabled .mps-box { background: var(--bg-tertiary); cursor: not-allowed; }

.mps-chip {
  display: inline-flex; align-items: center; gap: 3px;
  max-width: 100%;
  padding: 2px 4px 2px 8px;
  border-radius: 999px;
  background: rgba(var(--accent-rgb), 0.12);
  color: var(--accent-hover, var(--accent));
  font-size: 12px;
}
.mps-chip-text { max-width: 190px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mps-chip-x {
  border: none; background: none; padding: 0 3px;
  color: inherit; font-size: 14px; line-height: 1; cursor: pointer; opacity: 0.7;
}
.mps-chip-x:hover { opacity: 1; }

.mps-input {
  flex: 1; min-width: 90px;
  border: none; outline: none; background: transparent;
  color: var(--text-bright); font-family: inherit; font-size: 13px;
  padding: 3px 0;
}
.mps-input::placeholder { color: var(--text-secondary); }

.mps-dropdown {
  position: fixed;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.1), 0 2px 8px rgba(0,0,0,0.06);
  z-index: 11000;
  max-height: 240px;
  overflow-y: auto;
  padding: 4px;
}
.mps-option {
  display: flex; align-items: center; justify-content: space-between; gap: 10px;
  padding: 8px 10px; border-radius: 6px;
  font-size: 13px; color: var(--text-bright); cursor: pointer;
}
.mps-option:hover, .mps-option.highlighted { background: rgba(var(--accent-rgb), 0.08); color: var(--accent); }
.mps-option-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mps-option-hint { flex-shrink: 0; font-size: 11px; color: var(--text-secondary); }
.mps-option-free .mps-option-label { font-style: italic; }
.mps-empty { padding: 16px; text-align: center; font-size: 13px; color: var(--text-secondary); }

.mps-drop-enter-active { transition: opacity 0.18s ease, transform 0.18s ease; }
.mps-drop-leave-active { transition: opacity 0.14s ease, transform 0.14s ease; }
.mps-drop-enter-from, .mps-drop-leave-to { opacity: 0; transform: scaleY(0.94) translateY(-4px); }
.mps-dropdown.up.mps-drop-enter-from, .mps-dropdown.up.mps-drop-leave-to { transform: scaleY(0.94) translateY(4px); }

@media (prefers-reduced-motion: reduce) {
  .mps-box, .mps-option { transition: none; }
}
</style>