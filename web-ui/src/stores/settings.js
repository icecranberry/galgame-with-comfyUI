import { defineStore } from 'pinia'
import { ref } from 'vue'
import * as api from '../api/index.js'

export const useSettingsStore = defineStore('settings', () => {
  const comfyWidth = ref(1600)
  const comfyHeight = ref(1200)
  const forceImageGen = ref(false)
  const realtimeAffinityDisplay = ref(false)
  let loaded = false

  // ── localStorage 迁移：旧版存在 localStorage，新版存 DB ──
  const legacyForceImageGen = localStorage.getItem('forceImageGen')
  if (legacyForceImageGen !== null) {
    forceImageGen.value = legacyForceImageGen === 'true'
    localStorage.removeItem('forceImageGen')
    // 异步持久化到后端（fire-and-forget）
    api.updateFeatureFlag('forceImageGen', forceImageGen.value).catch(() => {})
  }

  async function loadComfyConfig() {
    if (loaded) return
    try {
      const data = await api.getConfig()
      comfyWidth.value = data.comfy?.width || 1600
      comfyHeight.value = data.comfy?.height || 1200
      if (data.features?.forceImageGen !== undefined) {
        forceImageGen.value = data.features.forceImageGen
      }
      if (data.features?.realtimeAffinityDisplay !== undefined) {
        realtimeAffinityDisplay.value = data.features.realtimeAffinityDisplay
      }
      loaded = true
    } catch {
      // keep defaults
    }
  }

  /**
   * 由外部调用更新（SettingsView 保存后同步）
   */
  function setComfySize(width, height) {
    comfyWidth.value = width
    comfyHeight.value = height
  }

  /**
   * 切换强制生图开关，持久化到后端
   */
  async function setForceImageGen(v) {
    forceImageGen.value = v
    await api.updateFeatureFlag('forceImageGen', v)
  }

  async function setRealtimeAffinityDisplay(v) {
    realtimeAffinityDisplay.value = v
    await api.updateFeatureFlag('realtimeAffinityDisplay', v)
  }

  return { comfyWidth, comfyHeight, forceImageGen, realtimeAffinityDisplay, loadComfyConfig, setComfySize, setForceImageGen, setRealtimeAffinityDisplay }
})
