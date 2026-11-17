<template>
  <div class="standing-generation-direction">
    <label :for="inputId">生成方向</label>
    <div class="standing-generation-controls">
      <linshe-tabs v-if="!hideOutfits" v-model="outfitScene" :options="outfitOptions" size="sm" :disabled="disabled" aria-label="生成使用的角色形象" />
      <linshe-input :id="inputId" v-model="requirement" :maxlength="2000" :disabled="disabled" placeholder="例如换成冬装、修改发色、动作更含蓄…（可选）" />
    </div>
  </div>
</template>

<script setup>
import LinsheTabs from '../ui/LinsheTabs.vue'
import LinsheInput from '../ui/LinsheInput.vue'

defineProps({ inputId: { type: String, required: true }, disabled: Boolean, batch: Boolean, hideOutfits: Boolean })
const outfitScene = defineModel('outfitScene', { type: String, default: 'work' })
const requirement = defineModel({ type: String, default: '' })
const outfitOptions = [
  { label: '默认', value: 'work' },
  { label: '私服', value: 'casual' },
  { label: '居家', value: 'home' },
  { label: '睡衣', value: 'sleep' },
]
</script>

<style scoped>
.standing-generation-direction { display: flex; flex-direction: column; gap: 8px; }
.standing-generation-direction label { color: var(--text-primary); font-size: var(--fs-sm); font-weight: 600; }
.standing-generation-controls { display: flex; align-items: center; gap: 12px; }
.standing-generation-controls > .ls-tabs { flex-shrink: 0; --dur-fast: .3s; }
.standing-generation-controls > .ls-input { flex: 1; min-width: 0; width: auto; }
.standing-generation-direction p { margin: 0; color: var(--text-secondary); font-size: var(--fs-xs); line-height: 1.7; }
@media (max-width: 600px) {
  .standing-generation-controls { flex-direction: column; align-items: stretch; gap: 8px; }
}
</style>
