import { ref } from 'vue'
import * as api from './api/index.js'

export const userAvatar = ref(null)
export const userNickname = ref('')
export const userGender = ref('')
export const userAppearance = ref('')
export const userPersona = ref('')

export async function loadUserConfig() {
  try {
    const data = await api.getUserConfig()
    userNickname.value = data.nickname || ''
    userGender.value = data.gender || ''
    userAppearance.value = data.appearance || ''
    userPersona.value = data.persona || ''
  } catch {}
}

export async function saveUserConfig({ nickname, gender, appearance, persona }) {
  await api.updateUserConfig({ nickname, gender, appearance, persona })
  if (nickname !== undefined) userNickname.value = nickname
  if (gender !== undefined) userGender.value = gender
  if (appearance !== undefined) userAppearance.value = appearance
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
