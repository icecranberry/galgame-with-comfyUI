<template>
  <div class="town-capabilities" role="group" aria-label="功能权限，可同时选择服务和交易">
    <linshe-button v-for="item in types" :key="item.value" variant="chip" size="sm"
      :active="modelValue.includes(item.value)" :aria-pressed="modelValue.includes(item.value)"
      :disabled="disabled"
      :title="item.hint" @click="toggle(item.value)">{{ item.label }}</linshe-button>
  </div>
</template>
<script setup>
import LinsheButton from '../ui/LinsheButton.vue'
const props = defineProps({ modelValue: { type: Array, default: () => ['service'] }, disabled: Boolean })
const emit = defineEmits(['update:modelValue'])
const types = [{ value: 'service', label: '服务', hint: '提供服务，可创建特殊奇遇' },
  { value: 'trade', label: '交易', hint: '打开交易窗口，买卖道具' }]
function toggle(value) {
  const next = props.modelValue.includes(value) ? props.modelValue.filter(item => item !== value) : [...props.modelValue, value]
  if (next.length) emit('update:modelValue', types.map(item => item.value).filter(item => next.includes(item)))
}
</script>
<style scoped>
.town-capabilities { display: flex; flex-wrap: wrap; gap: 6px; }
</style>
