/**
 * 「可输入并自动检索的多选框」匹配逻辑 —— 回归测试。
 *
 * ★ 为什么值得单独测：用户口径是「涉及角色和涉及地点改为可输入并自动检索的选择框」，
 *   这类交互失败起来是**静默**的 —— 选不中、重复添加、想输新地点输不进去，
 *   都不会报错，只是"用着别扭"。这些都得用测试钉住。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeQuery, fuzzyScore, rankCandidates, shouldOfferFreeValue, canAddMore, labelOfValue,
} from '../src/utils/multiPickSearch.js'

const CHARS = [
  { value: '1', label: '绯英', hint: '' },
  { value: '2', label: '花火', hint: '' },
  { value: '3', label: '菲谢尔', hint: '' },
  { value: '7', label: '绯红之王', hint: '' },
]

test('★★★ 检索能命中（前缀优先于包含，包含优先于子序列）', () => {
  const r = rankCandidates(CHARS, '绯', new Set())
  assert.ok(r.length >= 2, '「绯」应能检索到绯英与绯红之王')
  assert.equal(r[0].label, '绯英', '前缀或靠前的匹配应排最前')
})

test('★★ 拼音大小写不敏感、忽略空格', () => {
  assert.equal(normalizeQuery('  Fei  Ying '), 'feiying')
  // 英文/拼音检索口径：大小写与空格不影响结果
  const opts = [{ value: 'a', label: 'Nice Place' }]
  assert.equal(rankCandidates(opts, 'niceplace', new Set()).length, 1)
})

test('★★★ 已选项必须从候选里去掉（否则会重复添加同一个人/地点）', () => {
  const r = rankCandidates(CHARS, '', new Set(['1']))
  assert.ok(!r.some(o => o.value === '1'), '已选的「绯英」不应再出现在候选里')
  const r2 = rankCandidates(CHARS, '绯', ['1'])
  assert.ok(!r2.some(o => o.value === '1'), '带检索词时同样要去掉已选')
})

test('★ 不匹配的候选要被丢掉（不是排到后面）', () => {
  const r = rankCandidates(CHARS, 'zzz不存在zzz', new Set())
  assert.deepEqual(r, [])
})

test('★ 空查询返回原顺序前 N 项（不重排、不丢弃）', () => {
  const r = rankCandidates(CHARS, '', new Set(), 2)
  assert.deepEqual(r.map(o => o.value), ['1', '2'])
})

test('★★★ 地点未收录时必须允许自由输入（否则用户选不了想要的地点）', () => {
  const opts = [{ value: '嬉步街', label: '嬉步街' }]
  // 输入了一个候选里没有的地名
  assert.equal(shouldOfferFreeValue('无名桥', [], new Set(), true), true,
    '候选里没有的地点应给出"就用它"的自由项')
  // 已经选中过的不再重复提供
  assert.equal(shouldOfferFreeValue('无名桥', [], new Set(['无名桥']), true), false)
  // 空输入不提供
  assert.equal(shouldOfferFreeValue('   ', [], new Set(), true), false)
  // 关掉自由输入则一律不提供
  assert.equal(shouldOfferFreeValue('无名桥', [], new Set(), false), false)
})

test('★★ 自由项不应与已匹配到的候选抢位置', () => {
  const opts = [{ value: '嬉步街', label: '嬉步街' }]
  const visible = rankCandidates(opts, '嬉步街', new Set())
  assert.equal(shouldOfferFreeValue('嬉步街', visible, new Set(), true), false,
    '候选里已有完全匹配项时，不该再多出一个"就用…"')
})

test('★ 上限保护：达到上限后不能再加（max<=0 表示不限）', () => {
  assert.equal(canAddMore([1, 2], 2), false)
  assert.equal(canAddMore([1], 2), true)
  assert.equal(canAddMore([1, 2, 3, 4, 5], 0), true, 'max=0 应视为不限')
  assert.equal(canAddMore([], 0), true)
})

test('★ 模糊匹配打分：完全一致 < 前缀 < 包含 < 子序列', () => {
  const s = (label, q) => fuzzyScore(label, normalizeQuery(q))
  assert.ok(s('嬉步街', '嬉步街') < s('嬉步街区', '嬉步街'), '完全一致应优于前缀')
  assert.ok(s('嬉步街区', '嬉步街') < s('旧嬉步街', '嬉步街'), '前缀应优于包含')
  assert.equal(s('完全无关', 'qwerty'), null, '不匹配应返回 null')
})

test('★ 坏候选不炸（null / 缺 value 的条目要被忽略，而不是抛错）', () => {
  const r = rankCandidates([null, { label: '没value' }, { value: 'x', label: '好的' }], '', new Set())
  assert.deepEqual(r.map(o => o.value), ['x'])
  assert.deepEqual(rankCandidates(null, 'a', new Set()), [])
})

test('★★★ 已选项要显示「名字」而不是「值」—— 角色多选的值是 id，直接显示 id 用户没法用', () => {
  // 实测踩过：角色 chip 上显示了 `100394`，用户完全不知道那是什么。
  const chars = [{ value: '100394', label: '绯英' }]
  assert.equal(labelOfValue(chars, '100394'), '绯英', '有候选时应显示人名')
  assert.equal(labelOfValue(chars, 100394), '绯英', '数字值也应能匹配（类型不敏感）')
})

test('★★ 找不到候选时原样显示值（自由输入 / 角色已被删或归档）', () => {
  assert.equal(labelOfValue([], '一个没收录的地名'), '一个没收录的地名')
  assert.equal(labelOfValue([{ value: 'x', label: 'X' }], 'y'), 'y')
  assert.equal(labelOfValue(null, 'z'), 'z')
})