import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  MENTION_QUERY_RE,
  applyMention,
  buildMentionOptions,
  useMentionPicker,
} from '../src/composables/useMentionPicker.js'

const members = [
  { id: 1, display_name: '小美' },
  { id: 2, display_name: '阿离' },
  { id: 3, display_name: '小满' },
]

function picker(list = members) {
  return useMentionPicker(() => list)
}

test('只在末尾的 @ 后面认过滤词', () => {
  assert.equal(MENTION_QUERY_RE.exec('@')[1], '')
  assert.equal(MENTION_QUERY_RE.exec('在吗@')[1], '')
  assert.equal(MENTION_QUERY_RE.exec('在吗@小')[1], '小')
  assert.equal(MENTION_QUERY_RE.exec('hi@阿离')[1], '阿离')
  // @ 后面已经有空格 / 已经不是末尾 → 不当作过滤中
  assert.equal(MENTION_QUERY_RE.exec('@小美 然后呢'), null)
  assert.equal(MENTION_QUERY_RE.exec('没有 at 的句子'), null)
})

test('候选首项固定是全体成员，其余按角色名包含匹配', () => {
  const plain = buildMentionOptions(members, '')
  assert.equal(plain[0].display_name, '全体成员')
  assert.equal(plain[0].isAll, true)
  assert.deepEqual(plain.slice(1).map(o => o.display_name), ['小美', '阿离', '小满'])

  const filtered = buildMentionOptions(members, '小')
  assert.equal(filtered.some(o => o.isAll), false)
  assert.deepEqual(filtered.map(o => o.display_name), ['小美', '小满'])

  // 手打「@所有人 / @全员 / @全体成员」都落在全体成员这一项上
  for (const label of ['全体成员', '所有人', '全员']) {
    assert.equal(buildMentionOptions(members, label)[0].isAll, true)
  }

  // 过滤词谁都不沾 → 空列表（面板据此关闭）
  assert.deepEqual(buildMentionOptions(members, 'zzz'), [])
})

test('sync 按输入内容开关面板并夹住高亮下标', () => {
  const m = picker()
  assert.equal(m.sync('你好'), false)
  assert.equal(m.open.value, false)

  assert.equal(m.sync('@'), true)
  assert.equal(m.open.value, true)
  assert.equal(m.options.value.length, 4)

  // 过滤后候选变少，高亮下标不能越界
  m.move(3)
  assert.equal(m.index.value, 3)
  assert.equal(m.sync('@小'), true)
  assert.deepEqual(m.options.value.map(o => o.display_name), ['小美', '小满'])
  assert.equal(m.index.value, 0)

  // 过滤词无人命中 → 面板关闭
  assert.equal(m.sync('@zzz'), false)
  assert.equal(m.open.value, false)

  // 末尾不再是 @（发出去了 / Shift+Enter 换行）也要关闭
  assert.equal(m.sync('@小美 然后呢'), false)
  assert.equal(m.open.value, false)

  // 选中回填后带出空格，面板同样收起
  assert.equal(m.sync('@全体成员 '), false)
})

test('像邮箱的输入不会误开面板（候选为空即关闭）', () => {
  const m = picker()
  assert.equal(m.sync('user@example.com'), false)
  assert.equal(m.open.value, false)
})

test('move 环绕，面板关闭时把方向键让给输入框', () => {
  const m = picker()
  assert.equal(m.move(1), false)
  m.sync('@')
  assert.equal(m.move(1), true)
  assert.equal(m.index.value, 1)
  assert.equal(m.move(-1), true)
  assert.equal(m.index.value, 0)
  assert.equal(m.move(-1), true)
  assert.equal(m.index.value, 3)
})

test('群成员为空时仍然能 @全体成员', () => {
  const m = picker([])
  assert.equal(m.sync('@'), true)
  assert.deepEqual(m.options.value.map(o => o.display_name), ['全体成员'])
})

test('current / activeId 只在面板打开时给出高亮项', () => {
  const m = picker()
  assert.equal(m.current.value, null)
  assert.equal(m.activeId.value, undefined)

  m.sync('@')
  assert.equal(m.current.value.display_name, '全体成员')
  assert.equal(m.activeId.value, 'mention-opt-all')

  m.move(1)
  assert.equal(m.current.value.display_name, '小美')
  assert.equal(m.activeId.value, 'mention-opt-m1')

  m.close()
  assert.equal(m.current.value, null)
  assert.equal(m.activeId.value, undefined)
})

test('选中后回填：替换末尾的 @过滤词，没有 @ 时补在末尾', () => {
  assert.equal(applyMention('在吗 @小', '小美'), '在吗 @小美 ')
  assert.equal(applyMention('@', '全体成员'), '@全体成员 ')
  assert.equal(applyMention('', '阿离'), '@阿离 ')
  assert.equal(applyMention('@小美 然后 @阿', '阿离'), '@小美 然后 @阿离 ')
})
