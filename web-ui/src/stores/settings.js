import { defineStore } from 'pinia'
import { ref } from 'vue'
import * as api from '../api/index.js'

export const useSettingsStore = defineStore('settings', () => {
  const comfyWidth = ref(1600)
  const comfyHeight = ref(1200)
  let loaded = false

  async function loadComfyConfig() {
    if (loaded) return
    try {
      const data = await api.getConfig()
      comfyWidth.value = data.comfy?.width || 1600
      comfyHeight.value = data.comfy?.height || 1200
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

  return { comfyWidth, comfyHeight, loadComfyConfig, setComfySize }
})
