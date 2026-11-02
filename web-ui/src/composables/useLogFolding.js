/**
 * 神说页运行日志的纯函数工具集。
 *
 * 这里的函数只做文本解析与折叠区间计算，不依赖 Vue / DOM，
 * 便于在 node --test 环境里直接单测。
 */

// 日志块起始行：`══════════ [provider → label] ══════════`
const START_LINE_RE = /^\s*═{5,}\s*\[\s*(.+?)\s*→\s*(.+?)\s*\]\s*═{5,}\s*$/
// 起始行之后的 `────` 分隔线（≥5 个 ─）
const RULE_LINE_RE = /^\s*─{5,}\s*$/
// `[label] model=...`
const MODEL_LINE_RE = /^\s*\[[^\]]*\]\s*model=/
// 任意 `[provider ← label ...]` 行
const BACK_LINE_RE = /^\s*\[[^\]]*←[^\]]*\]/
// 思考链 / 正文段落头
const REASONING_HEAD_RE = /^\s*\[[^\]]*←[^\]]*思考链\]\s*$/
const CONTENT_HEAD_RE = /^\s*\[[^\]]*←[^\]]*正文\]\s*$/
// usage / cache 行
const USAGE_LINE_RE = /^\s*\[(?:cache|usage)\]/
// 收尾行：≥30 个 ═
const END_LINE_RE = /^\s*═{30,}\s*$/

/**
 * 提取一条消息的可读文本（用于折叠摘要的字数统计与渲染）。
 * - 字符串直接返回
 * - 数组：text 片段拼接，image_url 片段显示为 `[图片]`
 * - 其它类型返回空串
 * 永不抛异常。
 * @param {any} messageOrContent
 * @returns {string}
 */
export function messageText(messageOrContent) {
  let content = messageOrContent
  if (content && typeof content === 'object' && !Array.isArray(content) && 'content' in content) {
    content = content.content
  }
  if (typeof content === 'string') return content
  if (content == null) return ''
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const part of content) {
    if (part == null) continue
    if (typeof part === 'string') {
      parts.push(part)
      continue
    }
    if (typeof part !== 'object') continue
    if (part.type === 'image_url' || part.image_url) {
      parts.push('[图片]')
      continue
    }
    if (typeof part.text === 'string') {
      parts.push(part.text)
      continue
    }
  }
  return parts.join('')
}

/**
 * 从整段文本里找出第一段括号配平的 JSON 数组文本并解析。
 * 用于 messages 区被日志前缀/后缀包裹、直接整体 parse 失败时兜底。
 * @param {string} text
 * @returns {Array|null}
 */
function extractJsonArray(text) {
  if (typeof text !== 'string') return null
  const start = text.indexOf('[')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
    } else if (ch === '[') {
      depth += 1
    } else if (ch === ']') {
      depth -= 1
      if (depth === 0) {
        const slice = text.slice(start, i + 1)
        try {
          const parsed = JSON.parse(slice)
          return Array.isArray(parsed) ? parsed : null
        } catch {
          return null
        }
      }
    }
  }
  return null
}

/**
 * 解析单个 LLM 日志块。
 * @param {string} text 后端返回的 entry.text
 * @returns {{provider:string,label:string,messages:Array|null,messagesRaw:string,reasoning:string,content:string,usage:string}}
 */
export function parseLlmBlock(text) {
  const empty = {
    provider: '',
    label: '',
    messages: null,
    messagesRaw: '',
    reasoning: '',
    content: '',
    usage: ''
  }
  if (typeof text !== 'string' || text === '') return empty

  const lines = text.split(/\r?\n/)

  // 1. 定位起始行
  let startIdx = -1
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(START_LINE_RE)
    if (m) {
      startIdx = i
      empty.provider = m[1].trim()
      empty.label = m[2].trim()
      break
    }
  }

  // 2. 定位 messages 区结束：下一条 ─── 或 `[label] model=` 或 `[provider ←`
  const msgStart = startIdx + 1
  let msgEnd = lines.length
  for (let i = msgStart; i < lines.length; i += 1) {
    const line = lines[i]
    if (RULE_LINE_RE.test(line) || MODEL_LINE_RE.test(line) || BACK_LINE_RE.test(line)) {
      msgEnd = i
      break
    }
  }
  const messagesRaw = lines.slice(msgStart, msgEnd).join('\n').trim()
  empty.messagesRaw = messagesRaw
  if (messagesRaw) {
    try {
      const parsed = JSON.parse(messagesRaw)
      if (Array.isArray(parsed)) empty.messages = parsed
    } catch {
      empty.messages = extractJsonArray(messagesRaw)
    }
  }

  // 3. 思考链 / 正文 / usage
  let reasoningHead = -1
  let contentHead = -1
  let tailStart = -1 // 第一个 usage 或收尾行，正文/思考链都在此之前结束
  for (let i = msgEnd; i < lines.length; i += 1) {
    const line = lines[i]
    if (reasoningHead < 0 && REASONING_HEAD_RE.test(line)) {
      reasoningHead = i
      continue
    }
    if (contentHead < 0 && CONTENT_HEAD_RE.test(line)) {
      contentHead = i
      continue
    }
    if (tailStart < 0 && (USAGE_LINE_RE.test(line) || END_LINE_RE.test(line))) {
      tailStart = i
    }
    if (USAGE_LINE_RE.test(line)) {
      const raw = line.trim()
      empty.usage = empty.usage ? `${empty.usage}\n${raw}` : raw
    }
  }

  const bodyEnd = tailStart >= 0 ? tailStart : lines.length
  if (reasoningHead >= 0) {
    const rEnd = contentHead >= 0 ? contentHead : bodyEnd
    empty.reasoning = lines.slice(reasoningHead + 1, rEnd).join('\n').trim()
  }
  if (contentHead >= 0) {
    empty.content = lines.slice(contentHead + 1, bodyEnd).join('\n').trim()
  }

  return empty
}

/**
 * 按 label 前缀 / 关键字判断日志类别。
 * @param {string} label
 * @returns {'moment'|'group'|'chat'|'media'|'event'|'generic'}
 */
export function classifyLabel(label) {
  const s = typeof label === 'string' ? label : ''
  if (s.includes('发朋友圈助手') || s.includes('日程赴约朋友圈')) return 'moment'
  if (s.startsWith('群聊#')) return 'group'
  if (s.includes('主聊天流')) return 'chat'
  if (s.startsWith('media:')) return 'media'
  if (['奇遇生成', '事件分支', '事件结局', '奇遇紧急联络'].some((k) => s.includes(k))) return 'event'
  return 'generic'
}

/**
 * 在 messages 里定位最后一个角色资料锚点。
 * 优先匹配 `## 你的外观`，其次匹配若干中文资料标题；找不到返回 -1。
 * @param {Array} messages
 * @returns {number}
 */
export function findPersonaIndex(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return -1
  const primary = /##\s*你的外观/
  for (let i = 0; i < messages.length; i += 1) {
    if (primary.test(messageText(messages[i]))) return i
  }
  const secondary = ['【角色外观信息】', '【角色人设', '【人物资料', '【角色人格】', '【角色身份】']
  for (let i = 0; i < messages.length; i += 1) {
    const t = messageText(messages[i])
    if (secondary.some((k) => t.includes(k))) return i
  }
  return -1
}

/**
 * 求第一个 system 消息下标，找不到返回 -1。
 * @param {Array} messages
 * @returns {number}
 */
function firstSystemIndex(messages) {
  for (let i = 0; i < messages.length; i += 1) {
    const role = messages[i] && messages[i].role
    if (role === 'system') return i
  }
  return -1
}

/**
 * 计算某类日志的折叠区间。
 * 返回 `{ collapsedRanges: [[start,end], ...], reason }`。
 * @param {Array} messages
 * @param {string} category classifyLabel 的结果
 * @returns {{collapsedRanges: Array<[number,number]>, reason: string}}
 */
export function computeFolds(messages, category) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { collapsedRanges: [], reason: 'empty' }
  }
  const last = messages.length - 1

  if (category === 'chat') {
    // 只展开最后一条，其余全折叠
    if (messages.length < 2) return { collapsedRanges: [], reason: 'chat-single' }
    return { collapsedRanges: [[0, last - 1]], reason: 'chat' }
  }

  if (category === 'group' || category === 'media') {
    // 全部折叠（消息太多）
    return { collapsedRanges: [[0, last]], reason: category }
  }

  // moment / event / generic：折叠角色资料锚点之前
  let anchor = findPersonaIndex(messages)
  let reason = 'persona'
  if (anchor < 0) {
    anchor = firstSystemIndex(messages)
    reason = anchor >= 0 ? 'system' : 'none'
  }
  if (anchor < 0) anchor = 0
  if (anchor > 0) {
    return { collapsedRanges: [[0, anchor - 1]], reason }
  }
  return { collapsedRanges: [], reason: 'no-fold' }
}
