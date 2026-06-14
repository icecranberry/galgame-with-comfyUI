import { ref } from 'vue'
import * as api from './api/index.js'

export const userAvatar = ref(null)
export const userNickname = ref('')
export const userPersona = ref('')

export async function loadUserConfig() {
  try {
    const data = await api.getUserConfig()
    userNickname.value = data.nickname || ''
    userPersona.value = data.persona || ''
  } catch {}
}

export async function saveUserConfig({ nickname, persona }) {
  await api.updateUserConfig({ nickname, persona })
  if (nickname !== undefined) userNickname.value = nickname
  if (persona !== undefined) userPersona.value = persona
}

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
