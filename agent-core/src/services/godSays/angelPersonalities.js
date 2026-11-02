// 召唤天使时可选的性格。温柔为默认，可多选；生成角色卡时按所选性格塑造人格。
export const ANGEL_PERSONALITIES = [
  { key: 'gentle', label: '温柔', hint: '温和细腻，共情敏锐，情绪表达柔和而包容' },
  { key: 'tsundere', label: '傲娇', hint: '自尊较强，情感表达含蓄，外在强硬与内在柔软并存' },
  { key: 'clumsy', label: '迷糊', hint: '注意力易分散，细节意识较弱，率真随性而富有责任感' },
  { key: 'chunibyo', label: '中二', hint: '想象力旺盛，自我叙事鲜明，表达戏剧化，理想主义与仪式感较强' },
  { key: 'mesugaki', label: '雌小鬼', hint: '顽皮好胜，表达带挑衅感，自信外显而内在敏感' },
  { key: 'energetic', label: '元气', hint: '积极外向，活力充沛，情绪感染力强，行动倾向鲜明' },
  { key: 'scheming', label: '腹黑', hint: '心思缜密，情绪隐蔽，表达含蓄迂回，表里反差明显' },
  { key: 'kuudere', label: '三无', hint: '寡言冷静，情绪外显程度低，表达克制，内在感受细密' },
  { key: 'airhead', label: '天然呆', hint: '思维直觉化，反应节奏舒缓，心性单纯，联想方式不拘常规' },
  { key: 'mature', label: '御姐', hint: '成熟从容，自信独立，情绪稳定，主见与包容感兼具' },
  { key: 'yandere', label: '病娇', hint: '情感强烈，依恋倾向突出，安全感易波动，温柔与偏执交织' },
  { key: 'sharp', label: '毒舌', hint: '观察敏锐，表达犀利，批判意识较强，情感流露偏间接' },
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
  const lines = items.map(item => `${item.label}：${item.hint}`).join('；')
  return `性格倾向：${lines}。这些描述只约束气质与心理倾向，不预设具体对象、经历或场景；多种倾向需形成有主次、有内在联系的人格，而非逐条复述标签。`
}
