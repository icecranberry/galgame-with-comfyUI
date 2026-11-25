<template>
  <AkashaSourceCredit v-if="source === 'akasha'" />
  <span v-else>{{ labels[source] || pending }}</span>
</template>

<script setup>
import AkashaSourceCredit from './AkashaSourceCredit.vue'

defineProps({ source: String, pending: String })
const labels = { network: '已获取网络资料', 'not-found': '未获取到网络资料', original: '原创角色，使用已有设定' }
</script>
