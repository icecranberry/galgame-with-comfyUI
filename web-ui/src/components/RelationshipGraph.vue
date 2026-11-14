<template>
  <RelationshipWorkspace :visible="visible" mode="character" :center-character="centerCharacter" @close="$emit('close')" />
</template>

<script setup>
import RelationshipWorkspace from './RelationshipWorkspace.vue'
defineProps({ visible: Boolean, centerCharacter: { type: Object, required: true }, allCharacters: { type: Array, default: () => [] } })
defineEmits(['close'])
</script>
