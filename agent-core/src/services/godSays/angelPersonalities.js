// 召唤天使时可选的性格。温柔为默认，可多选；生成角色卡时按所选性格塑造人格。
export const ANGEL_PERSONALITIES = [
  { key: 'gentle', label: '温柔' },
  { key: 'tsundere', label: '傲娇' },
  { key: 'clumsy', label: '迷糊' },
  { key: 'chunibyo', label: '中二' },
  { key: 'mesugaki', label: '雌小鬼' },
  { key: 'energetic', label: '元气' },
  { key: 'scheming', label: '腹黑' },
  { key: 'kuudere', label: '三无' },
  { key: 'airhead', label: '天然呆' },
  { key: 'mature', label: '御姐' },
  { key: 'yandere', label: '病娇' },
  { key: 'sharp', label: '毒舌' },
]

export const DEFAULT_ANGEL_PERSONALITY = 'gentle'

const BY_KEY = new Map(ANGEL_PERSONALITIES.map(item => [item.key, item]))

// 把前端传来的 key 数组整理成去重、白名单内的 key 列表；空值回落到默认「温柔」。
export function normalizePersonalities(value) {
  const list = Array.isArray(value) ? value : []
  const seen = new Set()
  const keys = []
  for (const item of list) {
    const key = typeof item === 'string' ? item : item?.key
    if (key && BY_KEY.has(key) && !seen.has(key)) { seen.add(key); keys.push(key) }
  }
  return keys.length ? keys : [DEFAULT_ANGEL_PERSONALITY]
}

export function personalityPrompt(keys) {
  const items = normalizePersonalities(keys).map(key => BY_KEY.get(key))
  return `【本次选中的核心性格】\n${items.map(item => item.label).join('、')}`
}
