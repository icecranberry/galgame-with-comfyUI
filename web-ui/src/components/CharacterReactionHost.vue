<template>
  <Toast
    :character-cards="cards"
    @character-dismiss="onDismiss"
    @character-pause="onPause"
    @character-media-fallback="onMediaFallback"
  />
</template>

<script setup>
/**
 * 角色通知宿主：只负责把 store 里的单条角色通知交给 Toast 的角色变体，
 * 并维护「现在适不适合展示」的场景状态。
 *
 * 首期只在主应用挂载（App.vue），独立立绘路由不重复挂载（§3.2）。
 * 立绘小窗是否打开与本宿主无关（§1）。
 */
import { computed, onMounted, onUnmounted, watch } from 'vue'
import Toast from './Toast.vue'
import { useCharacterReactionsStore } from '../stores/characterReactions.js'
import {
  detectSoftKeyboard,
  isCharacterNotificationBlocked,
  subscribeSceneChanges,
} from '../utils/characterReactionScene.js'

const reactions = useCharacterReactionsStore()
const cards = computed(() => reactions.shown)
let unsubscribeScene = null
let bodyObserver = null
let observerScheduled = false

function refreshScene() {
  const { blocked, reason } = isCharacterNotificationBlocked({ softKeyboard: detectSoftKeyboard() })
  reactions.setSceneBlocked(blocked, reason)
}

// 候选被场景挡下时排队；这里在排队期间重算场景，恢复后立刻补展示
watch(() => reactions.pending, (value) => { if (value) refreshScene() })

/**
 * 弹窗 / 演出都是 Teleport 到 body 的直接子元素，监听 body 子节点的增删与 class 变化即可即时重算遮挡；
 * 这是生命周期感知，不是用 DOM 扫描推断业务（§2.5 / §10.1）。
 */
function watchBodyChildren() {
  if (typeof MutationObserver !== 'function' || !document.body) return
  bodyObserver = new MutationObserver(() => {
    if (observerScheduled) return
    observerScheduled = true
    requestAnimationFrame(() => {
      observerScheduled = false
      refreshScene()
    })
  })
  bodyObserver.observe(document.body, { childList: true, subtree: false, attributes: true, attributeFilter: ['class'] })
}

onMounted(() => {
  refreshScene()
  unsubscribeScene = subscribeSceneChanges(refreshScene)
  watchBodyChildren()
  // 宿主就绪后再启动订阅，避免角色加载前的空转
  reactions.start()
})

onUnmounted(() => {
  if (unsubscribeScene) unsubscribeScene()
  unsubscribeScene = null
  if (bodyObserver) bodyObserver.disconnect()
  bodyObserver = null
  reactions.stop()
})

function onDismiss(id) {
  reactions.dismissDisplay(id)
}

function onPause(id, paused) {
  if (paused) reactions.pauseDisplay(id)
  else reactions.resumeDisplay(id)
}

function onMediaFallback(id) {
  reactions.demoteMedia(id)
}
</script>
