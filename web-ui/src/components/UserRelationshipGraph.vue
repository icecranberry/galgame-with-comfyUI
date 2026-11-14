<template>
  <RelationshipWorkspace :visible="visible" mode="user" @close="$emit('close')" @auto-deduce="$emit('auto-deduce')" />
</template>

<script setup>
import RelationshipWorkspace from './RelationshipWorkspace.vue'
defineProps({ visible: Boolean, allCharacters: { type: Array, default: () => [] } })
defineEmits(['close', 'auto-deduce'])
</script>
