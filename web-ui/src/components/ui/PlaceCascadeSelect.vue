<template>
  <!-- ── 地点级联选择（大地区 → 子地区 → 地点）──
       ★ 2026-10-07 用户口径：固定住处的下拉「难以查找地点」，要求改成**多级选择栏**、
         层级**按地图自动匹配**。

       ── 为什么不用单层可搜索下拉（原来是那样）──────────────
       实测：候选 **115 条**平铺在一个下拉里，只有名字没有任何归属信息 ——
       同一个名字（如「零重力货舱巷」）你不点开根本不知道它在哪张图的哪个区，
       而"重复名字在多个区"是常态。**平铺列表丢掉了地图本来就有层级这一事实**。

       本组件把层级如实还原：大地区 → 子地区 → 地点，逐级收敛。
       ★ 层级**不写死**：直接按 `options` 里每条自带的 region/area 分组，
         所以新增世界观/新增大地区都不用改这里（与「地点唯一真源 = 地图」一致）。

       ⚠ 最后一级仍保留搜索：一个子区下可能有几十个地点，逐条翻找同样难受。 -->
  <div class="pcs">
    <div class="pcs-row">
      <label class="pcs-label">大地区</label>
      <linshe-select
        v-model="region"
        :options="regionOptions"
        size="sm"
        :placeholder="regionOptions.length > 1 ? '选择大地区…' : (regionOptions[0]?.label || '无')"
        :disabled="disabled || regionOptions.length <= 1"
      />
    </div>
    <div class="pcs-row">
      <label class="pcs-label">子地区</label>
      <linshe-select
        v-model="area"
        :options="areaOptions"
        size="sm"
        placeholder="先选大地区…"
        :disabled="disabled || !region"
      />
    </div>
    <div class="pcs-row">
      <label class="pcs-label">地点</label>
      <linshe-select
        v-model="place"
        :options="placeOptions"
        size="sm"
        searchable
        :placeholder="area ? '搜索或选择地点…' : '先选子地区…'"
        :disabled="disabled || !area"
      />
    </div>

    <p v-if="!options.length" class="pcs-hint">世界地图里还没有可用地点</p>
    <p v-else-if="modelValue && !resolved" class="pcs-hint is-warn">
      当前值「{{ modelValue }}」已不在候选列表里（地图改过或地点被删），请重新选择
    </p>
  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
// ⚠ 本文件与 LinsheSelect 同在 `components/ui/`，用同级路径 `./`（写成 `../ui/` 会构建失败）。
import LinsheSelect from './LinsheSelect.vue'

/**
 * @typedef {{name:string, region?:string, area?:string, kind?:string, zone?:string}} PlaceOption
 */
const props = defineProps({
  /** 选中的**地点名**（后端注入与落库都用这个名字，不要改成 id） */
  modelValue: { type: String, default: '' },
  /** 扁平候选（后端 cadenceOptions：自带 region/area，本组件只做分组与收敛） */
  options: { type: Array, default: () => [] },
  disabled: { type: Boolean, default: false },
})

const emit = defineEmits(['update:modelValue', 'change'])

const region = ref('')
const area = ref('')
const place = ref('')

/** 归一化：只保留有名字的，并把归属补齐成字符串（避免 undefined 参与分组 / 比较） */
const list = computed(() => (Array.isArray(props.options) ? props.options : [])
  .map(o => ({
    name: String(o?.name || '').trim(),
    region: String(o?.region || '').trim(),
    area: String(o?.area || '').trim(),
    kind: o?.kind || '',
    zone: o?.zone || '',
  }))
  .filter(o => o.name))

/** 当前 modelValue 是否仍在候选里（不在时要显式提示，不能静默显示空白） */
const resolved = computed(() =>
  !props.modelValue || list.value.some(o => o.name === props.modelValue))

const regionOptions = computed(() => {
  const names = [...new Set(list.value.map(o => o.region).filter(Boolean))]
  return names.map(n => ({ label: n, value: n }))
})
const areaOptions = computed(() => {
  if (!region.value) return []
  const names = [...new Set(list.value.filter(o => o.region === region.value).map(o => o.area).filter(Boolean))]
  return names.map(n => ({ label: n, value: n }))
})
const placeOptions = computed(() => {
  if (!area.value) return []
  return list.value
    .filter(o => o.region === region.value && o.area === area.value)
    .map(o => ({
      // 居住性质的排前面并标注（居家/睡眠地点优先选住宅，但不强制 —— 角色可能住非住宅处）
      label: o.zone === 'residence' ? `${o.name}（居住）` : o.name,
      value: o.name,
    }))
})

/** 选中/清空时向上回传（'' = 不指定） */
function emitValue(v) {
  if (v === props.modelValue) return
  emit('update:modelValue', v || '')
  emit('change', v || '')
}

watch(place, v => emitValue(v))
// 上级变了 → 清掉下级，避免"大地区已换但地点还是上一个区的"
watch(region, () => { area.value = ''; place.value = '' })
watch(area, () => { place.value = '' })

/**
 * 外部传入 modelValue 时**反查层级并回填**三级选择 ——
 * 否则打开弹窗时下拉是空的，用户看不到"当前设的是哪"（只会以为是没设）。
 */
watch([() => props.modelValue, list], ([v]) => {
  if (!v) { region.value = ''; area.value = ''; place.value = ''; return }
  if (place.value === v && region.value && area.value) return   // 自己刚选出来的，别回填打断
  const hit = list.value.find(o => o.name === v)
  if (!hit) { place.value = v; return }   // 不在候选里：保留原值，由模板提示"已不在列表"
  region.value = hit.region
  area.value = hit.area
  place.value = hit.name
}, { immediate: true })
</script>

<style scoped>
.pcs { display: flex; flex-direction: column; gap: 8px; }
.pcs-row { display: flex; align-items: center; gap: 10px; }
.pcs-label {
  flex: 0 0 56px;
  font-size: var(--fs-xs);
  color: var(--text-secondary);
}
.pcs-row :deep(.ls-select-wrapper) { flex: 1; min-width: 0; }
.pcs-hint { margin: 2px 0 0; font-size: var(--fs-xs); color: var(--text-secondary); }
.pcs-hint.is-warn { color: var(--warning, #d48806); }
</style>