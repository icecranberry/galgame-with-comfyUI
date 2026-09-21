<template>
  <div class="town-capabilities" role="group" aria-label="功能权限，可同时选择服务、交易和打工">
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
const types = [{ value: 'service', label: '服务', hint: '提供服务，玩家花钱买 TA 的服务' },
  { value: 'trade', label: '交易', hint: '打开货摊，买卖道具' },
  { value: 'work', label: '打工', hint: '玩家替 TA 干活，TA 付工资' }]
function toggle(value) {
  const next = props.modelValue.includes(value) ? props.modelValue.filter(item => item !== value) : [...props.modelValue, value]
  if (next.length) emit('update:modelValue', types.map(item => item.value).filter(item => next.includes(item)))
}
</script>
<style scoped>
.town-capabilities { display: flex; flex-wrap: wrap; gap: 6px; }
</style>
