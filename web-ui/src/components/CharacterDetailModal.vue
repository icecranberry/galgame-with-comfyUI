<template>
  <GodAngelDetailModal v-if="character?.system_role === 'angel'" :visible="visible" :character="character" v-bind="$attrs" />
  <ResidentCharacterDetailModal v-else :visible="visible" :character="character" v-bind="$attrs" />
</template>

<script setup>
import GodAngelDetailModal from './godSays/GodAngelDetailModal.vue'
import ResidentCharacterDetailModal from './ResidentCharacterDetailModal.vue'

defineOptions({ inheritAttrs: false })
defineProps({ visible: Boolean, character: { type: Object, default: null } })
// 天使适配器也渲染同一个 ResidentCharacterDetailModal，仅替换数据接口并隐藏居民专属功能。
</script>
