import test from 'node:test'
import assert from 'node:assert/strict'

import {
  parseLlmBlock,
  classifyLabel,
  findPersonaIndex,
  computeFolds,
  messageText
} from '../src/composables/useLogFolding.js'

const RULE = '─'.repeat(48)
const CLOSE = '═'.repeat(47)

/**
 * 拼一个贴近后端 llm-client.js 真实 stdout 的日志块。
 */
function buildBlock({ provider = 'deepseek', label = '神说', messages, reasoning = '', content = '', usage = '' }) {
  const lines = []
  lines.push(`\n══════════ [${provider} → ${label}] ══════════`)
  lines.push(JSON.stringify(messages, null, 2))
  lines.push(`[${label}] model=deepseek-flash, tools=0, max_tokens=2048`)
  lines.push(`[${label} 可用工具] `)
  lines.push(RULE)
  lines.push(`[${provider} ← ${label} start]`)
  if (reasoning) {
    lines.push(`[${provider} ← ${label} 思考链]`)
    lines.push(reasoning)
  }
  lines.push(`[${provider} ← ${label} 正文]`)
  lines.push(content)
  if (usage) lines.push(usage)
  lines.push(CLOSE)
  return lines.join('\n')
}

test('parseLlmBlock 解析正常块（messages/思考链/正文/usage）', () => {
  const messages = [
    { role: 'system', content: '固定规则' },
    { role: 'user', content: [{ type: 'text', text: '你好' }] }
  ]
  const text = buildBlock({
    messages,
    reasoning: '我在思考这件事',
    content: '这是正文输出',
    usage: '[cache] 神说: 命中 10/20 prompt tokens (50%) | 输出 5'
  })
  const r = parseLlmBlock(text)
  assert.equal(r.provider, 'deepseek')
  assert.equal(r.label, '神说')
  assert.deepEqual(r.messages, messages)
  assert.ok(r.messagesRaw.trim().startsWith('['))
  assert.equal(r.reasoning, '我在思考这件事')
  assert.equal(r.content, '这是正文输出')
  assert.ok(r.usage.includes('[cache]'))
})

test('parseLlmBlock 支持 [usage] 行且不吞正文', () => {
  const text = buildBlock({
    messages: [{ role: 'user', content: 'hi' }],
    content: '正文',
    usage: '[usage] 神说: prompt 8 | 输出 3'
  })
  const r = parseLlmBlock(text)
  assert.equal(r.content, '正文')
  assert.ok(r.usage.includes('[usage]'))
})

test('parseLlmBlock 消息 JSON 截断时 messages=null 且不抛', () => {
  const truncated = [
    '',
    '══════════ [p → l] ══════════',
    '[',
    '  {',
    '    "role": "system",',
    '    "content": "这是一个很长但被截断的输出',
    CLOSE
  ].join('\n')
  const r = parseLlmBlock(truncated)
  assert.equal(r.messages, null)
  assert.equal(typeof r.messagesRaw, 'string')
})

test('parseLlmBlock 畸形输入不抛异常', () => {
  for (const bad of [null, undefined, 123, {}, '']) {
    const r = parseLlmBlock(bad)
    assert.equal(r.messages, null)
    assert.equal(r.reasoning, '')
    assert.equal(r.content, '')
  }
})

test('classifyLabel 六类归属', () => {
  assert.equal(classifyLabel('朋友圈发朋友圈助手'), 'moment')
  assert.equal(classifyLabel('日程赴约朋友圈'), 'moment')
  assert.equal(classifyLabel('群聊#3'), 'group')
  assert.equal(classifyLabel('主聊天流'), 'chat')
  assert.equal(classifyLabel('media:abc'), 'media')
  assert.equal(classifyLabel('奇遇生成'), 'event')
  assert.equal(classifyLabel('事件分支'), 'event')
  assert.equal(classifyLabel('事件结局'), 'event')
  assert.equal(classifyLabel('奇遇紧急联络'), 'event')
  assert.equal(classifyLabel('随便什么'), 'generic')
  assert.equal(classifyLabel(null), 'generic')
})

test('findPersonaIndex 优先命中 ## 你的外观', () => {
  const msg = [
    { role: 'system', content: '规则' },
    { role: 'user', content: '## 你的外观\n白发红瞳' },
    { role: 'user', content: '你好' }
  ]
  assert.equal(findPersonaIndex(msg), 1)
})

test('findPersonaIndex 支持多模态数组与次选锚点', () => {
  const multimodal = [
    { role: 'system', content: '规则' },
    { role: 'user', content: [{ type: 'text', text: '## 你的外观\n红瞳' }] }
  ]
  assert.equal(findPersonaIndex(multimodal), 1)

  assert.equal(findPersonaIndex([{ role: 'system', content: '【角色人设】甲' }]), 0)
  assert.equal(findPersonaIndex([{ role: 'system', content: '【角色身份】乙' }]), 0)
  assert.equal(findPersonaIndex([{ role: 'user', content: 'hi' }]), -1)
  assert.equal(findPersonaIndex(null), -1)
  assert.equal(findPersonaIndex([]), -1)
})

test('computeFolds chat 只展开最后一条', () => {
  const five = Array.from({ length: 5 }, (_, i) => ({ role: 'user', content: `m${i}` }))
  assert.deepEqual(computeFolds(five, 'chat').collapsedRanges, [[0, 3]])
  assert.deepEqual(computeFolds([{ role: 'user', content: 'x' }], 'chat').collapsedRanges, [])
})

test('computeFolds group/media 全部折叠', () => {
  const five = Array.from({ length: 5 }, (_, i) => ({ role: 'user', content: `m${i}` }))
  assert.deepEqual(computeFolds(five, 'group').collapsedRanges, [[0, 4]])
  assert.deepEqual(computeFolds(five, 'media').collapsedRanges, [[0, 4]])
})

test('computeFolds moment/event/generic 折叠角色资料之前', () => {
  const withPersona = [
    { role: 'system', content: '规则' },
    { role: 'user', content: '历史' },
    { role: 'user', content: '## 你的外观\n白发' },
    { role: 'user', content: '你好' }
  ]
  assert.deepEqual(computeFolds(withPersona, 'moment').collapsedRanges, [[0, 1]])
  assert.deepEqual(computeFolds(withPersona, 'event').collapsedRanges, [[0, 1]])
  assert.deepEqual(computeFolds(withPersona, 'generic').collapsedRanges, [[0, 1]])
})

test('computeFolds 无角色资料时退化为第一个 system', () => {
  const noPersona = [
    { role: 'system', content: 's' },
    { role: 'user', content: 'u' }
  ]
  // 第一个 system 在 0 → 折叠区间无效 → 空
  assert.deepEqual(computeFolds(noPersona, 'moment').collapsedRanges, [])

  const sysAt1 = [
    { role: 'user', content: 'u' },
    { role: 'system', content: 's' }
  ]
  assert.deepEqual(computeFolds(sysAt1, 'moment').collapsedRanges, [[0, 0]])
})

test('computeFolds 空/畸形输入安全返回', () => {
  assert.deepEqual(computeFolds([]).collapsedRanges, [])
  assert.deepEqual(computeFolds(null).collapsedRanges, [])
  assert.deepEqual(computeFolds(undefined, 'chat').collapsedRanges, [])
})

test('messageText 处理多模态数组', () => {
  assert.equal(messageText('abc'), 'abc')
  assert.equal(
    messageText([
      { type: 'text', text: '你好' },
      { type: 'image_url', image_url: { url: 'http://x/y.png' } },
      { type: 'text', text: '世界' }
    ]),
    '你好[图片]世界'
  )
  assert.equal(messageText({ role: 'user', content: 'hi' }), 'hi')
  assert.equal(messageText(null), '')
  assert.equal(messageText(undefined), '')
  assert.equal(messageText(123), '')
})
