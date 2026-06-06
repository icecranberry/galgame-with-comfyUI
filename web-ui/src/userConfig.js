import { ref } from 'vue'
import * as api from './api/index.js'

export const userAvatar = ref(null)

export async function loadUserAvatar() {
  try {
    const data = await api.getUserAvatar()
    userAvatar.value = data.avatar_path || null
  } catch {}
}

export async function uploadUserAvatar(base64) {
  const result = await api.uploadUserAvatar(base64)
  userAvatar.value = result.avatar_path || null
  return result
}
