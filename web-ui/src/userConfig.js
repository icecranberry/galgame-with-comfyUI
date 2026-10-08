import { ref } from 'vue'
import * as api from './api/index.js'

export const userAvatar = ref(null)
export const userNickname = ref('')
export const userGender = ref('')
export const userAppearance = ref('')
export const userPersona = ref('')
/** 人类（用户）的居住地点 = 世界地图里的一个地点名；空串 = 未指定（不猜） */
export const userHome = ref('')

export async function loadUserConfig() {
  try {
    const data = await api.getUserConfig()
    userNickname.value = data.nickname || ''
    userGender.value = data.gender || ''
    userAppearance.value = data.appearance || ''
    userPersona.value = data.persona || ''
    userHome.value = data.home || ''
  } catch {}
}

export async function saveUserConfig({ nickname, gender, appearance, persona, home }) {
  await api.updateUserConfig({ nickname, gender, appearance, persona, home })
  if (nickname !== undefined) userNickname.value = nickname
  if (gender !== undefined) userGender.value = gender
  if (appearance !== undefined) userAppearance.value = appearance
  if (persona !== undefined) userPersona.value = persona
  // home 用 `!== undefined` 而不是真值判断 —— 空串是**合法值**（清空已选居住地）
  if (home !== undefined) userHome.value = home
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
