<template>
  <router-view v-if="route.meta.standingDisplay || route.meta.gamePlayer" :key="route.meta.gamePlayer ? route.params.gameId : undefined" />
  <App v-else />
  <ExpressionStandingManager v-if="standingPanel" :open="standingOpen" :player="standingPanel.subject === 'player'" :character="standingPanel.character" @close="closeStandingPanel" />
  <ConfirmDialog v-if="standingPanel" ref="standingConfirm" />
</template>
<script setup>
import { defineAsyncComponent, provide, ref, shallowRef, watch } from 'vue'
import { useRoute } from 'vue-router'
import App from './App.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import { listCharacters } from './api/index.js'

const ExpressionStandingManager = defineAsyncComponent(() => import('./components/ExpressionStandingManager.vue'))
const route = useRoute()
const standingPanel = shallowRef(null), standingOpen = ref(false)
const standingConfirm = ref(null)

provide('confirm', options => standingConfirm.value?.show(options) ?? Promise.resolve(false))

provide('openGameStandings', async (subject, onClose) => {
  const character = subject === 'player' ? null : (await listCharacters()).characters?.find(item => item.id === subject)
  if (subject !== 'player' && !character) throw new Error('角色已不存在')
  if (!route.meta.gamePlayer || route.params.gameId !== 'trpg-simulator' || standingOpen.value) return
  standingPanel.value = { subject, character, onClose }
  standingOpen.value = true
})

function closeStandingPanel() {
  if (!standingOpen.value) return
  standingOpen.value = false
  standingPanel.value?.onClose()
}
watch(() => route.params.gameId, () => { if (standingOpen.value) closeStandingPanel() })
</script>
