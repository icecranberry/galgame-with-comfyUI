<template>
  <router-view v-if="route.meta.standingDisplay || route.meta.gamePlayer" :key="route.meta.gamePlayer ? route.params.gameId : undefined" />
  <App v-else />
  <ExpressionStandingManager v-if="standingPanel" :open="standingOpen" :player="standingPanel.player" :character="standingPanel.character" @close="closeStandingPanel" />
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
  const player = subject.player === true
  const matches = player ? [] : (await listCharacters()).characters?.filter(item =>
    (item.display_name?.trim() || item.name?.trim()) === subject.characterName) ?? []
  if (!player && matches.length !== 1) throw new Error('无法按名字唯一识别角色')
  if (!route.meta.gamePlayer || route.params.gameId !== 'trpg-simulator' || standingOpen.value) return
  standingPanel.value = { player, character: matches[0], onClose }
  standingOpen.value = true
})

function closeStandingPanel() {
  if (!standingOpen.value) return
  standingOpen.value = false
  standingPanel.value?.onClose()
}
watch(() => route.params.gameId, () => { if (standingOpen.value) closeStandingPanel() })
</script>
