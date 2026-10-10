import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import * as api from '../api/index.js'
import { onEvent } from './unifiedStream.js'

export const useBackpackStore = defineStore('backpack', () => {
  const items = ref([])
  const pendingItems = ref([])
  const chest = ref({ canOpen: true, remainingSeconds: 0, cooldownHours: 16 })
  const chestLoaded = ref(false)
  const activeEffects = ref([])
  const loading = ref(false)

  let pollTimer = null
  let _unsubItemReady = null
  let _pollingRefs = 0

  const usableItems = computed(() => items.value.filter(i => i.status === 'ready'))
  // 红点默认不显示：完成一次真实查询、且确认宝箱就绪后才亮
  const chestReady = computed(() => chestLoaded.value && chest.value.canOpen)

  async function fetchItems() {
    loading.value = true
    try {
      const data = await api.listItems()
      // 生成中的道具不上架：图片就绪（status=ready）后才出现在背包
      items.value = (data.items || []).filter(i => i.status !== 'generating')
      // 待收下：开箱后尚未收下的道具，只在宝箱面板展示
      pendingItems.value = data.pendingItems || []
      chest.value = data.chest || chest.value
      chestLoaded.value = true
      activeEffects.value = data.activeEffects || []
    } catch (err) {
      console.error('[backpack] fetchItems error:', err)
    } finally {
      loading.value = false
    }
  }

  /** 本地倒计时 tick（每秒），把剩余秒数往下降 */
  function _tickCooldown() {
    if (chest.value.remainingSeconds > 0) {
      chest.value.remainingSeconds = Math.max(0, chest.value.remainingSeconds - 1)
      if (chest.value.remainingSeconds === 0) chest.value.canOpen = true
    }
  }

  async function openChest() {
    const result = await api.openChest()
    if (result.ok) {
      chest.value.canOpen = false
      // 冷却从此刻起算
      chest.value.remainingSeconds = (chest.value.cooldownHours || 16) * 3600
      await fetchItems()
    }
    return result
  }

  async function useItem(itemId, characterId) {
    const result = await api.useItem(itemId, characterId)
    if (result.ok) {
      items.value = items.value.filter(i => i.id !== itemId)
      const activeEffect = result.activeEffect
      if (activeEffect) {
        const rest = activeEffects.value.filter(effect =>
          !(String(effect.character_id) === String(activeEffect.character_id)
            && effect.effect_key === activeEffect.effect_key)
        )
        activeEffects.value = [activeEffect, ...rest]
      }
    }
    return result
  }

  async function collectItem(itemId) {
    const result = await api.collectItem(itemId)
    if (result.ok) await fetchItems()
    return result
  }

  async function discardItem(itemId) {
    await api.discardItem(itemId)
    items.value = items.value.filter(i => i.id !== itemId)
    pendingItems.value = pendingItems.value.filter(i => i.id !== itemId)
  }

  async function removeActiveEffect(effectId) {
    const result = await api.removeActiveEffect(effectId)
    if (result.ok) {
      activeEffects.value = activeEffects.value.filter(effect => effect.id !== effectId)
    }
    return result
  }

  function _onItemReady(data) {
    const item = items.value.find(i => i.id === data.itemId)
    if (item) {
      item.status = 'ready'
      item.image_url = data.imageUrl || null
    }
    const pending = pendingItems.value.find(i => i.id === data.itemId)
    if (pending) {
      pending.status = 'ready'
      pending.image_url = data.imageUrl || null
    }
    // 图片完成后后端才写入宝箱冷却，重新拉一次以刷新冷却倒计时
    fetchItems()
  }

  function startPolling() {
    _pollingRefs++
    if (_pollingRefs > 1) return

    fetchItems()
    _unsubItemReady = onEvent('item_ready', _onItemReady)
    pollTimer = setInterval(fetchItems, 60000)
  }

  function stopPolling() {
    _pollingRefs = Math.max(0, _pollingRefs - 1)
    if (_pollingRefs > 0) return
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
    if (_unsubItemReady) { _unsubItemReady(); _unsubItemReady = null }
  }

  return {
    items, pendingItems, chest, activeEffects, loading,
    usableItems, chestReady,
    fetchItems, openChest, collectItem, useItem, discardItem, removeActiveEffect,
    startPolling, stopPolling, _tickCooldown,
  }
})
