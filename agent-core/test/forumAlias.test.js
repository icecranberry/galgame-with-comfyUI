import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ALIAS_SOURCES,
  ALIAS_FORMS,
  ALIAS_STANCES,
  buildAliasRuleBlock,
  collectUsedAliases,
  disambiguateAliases,
  buildForumAliasGenPrompt,
} from '../src/services/forumAlias.js'
import { normalizeMediaDraft } from '../src/services/mediaService.js'

/**
 * 这组测试守三件事：
 *   1. 三轴分类都真的进了规则文本（漏一轴就会退化成"只有名字花、发言同质"）
 *   2. 去重：已用名单喂回模型 + 同批重名消歧（重名不丢弃）
 *   3. 角色马甲：论坛署名用马甲、且**不参与**消歧（必须稳定）
 */

test('三轴分类都有内容，且取材里保留了"市井日常"这一类', () => {
  assert.ok(ALIAS_SOURCES.length >= 8, '取材轴条目太少，多样性会不够')
  assert.ok(ALIAS_FORMS.length >= 6, '形态轴条目太少')
  assert.ok(ALIAS_STANCES.length >= 6, '立场轴条目太少')
  // 全是怪名的论坛是假的 —— 必须有"最普通的那种 ID"
  assert.ok(ALIAS_SOURCES.some(s => s.id === 'plain'))
})

test('规则块把三轴都写进去了', () => {
  const block = buildAliasRuleBlock()
  assert.match(block, /【取材】/)
  assert.match(block, /【形态】/)
  assert.match(block, /【立场】/)
  // 硬性约束必须出现，否则模型不会当回事
  assert.match(block, /绝对不许重复/)
  assert.match(block, /禁止.*用户1/)
})

test('已用名单被写进规则；重复项会去重，"匿名"被过滤', () => {
  const block = buildAliasRuleBlock({ used: ['楼下便利店', '小明', '楼下便利店', '匿名', '  '] })
  assert.match(block, /已用过的网名/)
  // 只在「已用名单」那一段里数重复 —— 分类示例里本身就有"楼下便利店"，
  // 对整个 block 计数会把示例算进去（第一版断言就是这么写错的）
  const listPart = block.slice(block.indexOf('已用过的网名'))
  assert.match(listPart, /楼下便利店/)
  assert.match(listPart, /小明/)
  assert.equal(listPart.split('楼下便利店').length - 1, 1, '重复的网名应被去重')
  // "匿名"是无意义兜底值，不该被当成占用名额
  assert.ok(!listPart.includes('匿名'), '匿名不该出现在已用名单里')
})

test('没有已用名单时不输出那一段', () => {
  const block = buildAliasRuleBlock()
  assert.doesNotMatch(block, /已用过的网名/)
  assert.doesNotMatch(buildAliasRuleBlock({ used: [] }), /已用过的网名/)
})

test('collectUsedAliases 同时收发帖人与评论者，并去重', () => {
  const posts = [
    { author_name: 'A', comments: [{ author: 'B' }, { author: 'A' }] },
    { author_name: 'C', comments: [{ author: 'B' }] },
    { author_name: '', comments: [] },
  ]
  assert.deepEqual(collectUsedAliases(posts), ['A', 'B', 'C'])
  assert.deepEqual(collectUsedAliases([]), [])
  assert.deepEqual(collectUsedAliases(null), [])
})

test('disambiguateAliases 保留全部名字，重名追加序号而不是丢弃', () => {
  assert.deepEqual(disambiguateAliases(['小明', '小红', '小明', '小明']), ['小明', '小红', '小明2', '小明3'])
  assert.deepEqual(disambiguateAliases([]), [])
  // 空值兜底成"匿名"，同样参与消歧
  assert.deepEqual(disambiguateAliases(['', '']), ['匿名', '匿名2'])
})

test('buildForumAliasGenPrompt 要求马甲不暴露身份，并要求 JSON 示例', () => {
  const { system, user } = buildForumAliasGenPrompt({ display_name: '阿米莉亚·冲锤', short_prompt: '性格直率' })
  assert.match(system, /三轴交叉搭配/)
  assert.match(system, /不能被一眼认出/)
  assert.match(user, /阿米莉亚·冲锤/)
  assert.match(user, /性格直率/)
  // LLM 输出 JSON 必须给完整字段示例（AGENTS.md 的硬要求）
  assert.match(user, /"alias"/)
  assert.match(user, /"persona"/)
})

test('normalizeMediaDraft：角色在论坛用马甲署名，没填马甲才退回真名', () => {
  const boards = [{ id: 1, name: '日常' }]
  const authors = [
    { id: 7, display_name: '阿米莉亚·冲锤', forum_alias: '三缺一叫我', avatar_path: null },
    { id: 8, display_name: '索菲亚_准星', avatar_path: null },
  ]
  const raw = { posts: [
    { board: '日常', title: 'T1', content: 'C1', comments: [] },
    { board: '日常', title: 'T2', content: 'C2', comments: [] },
  ] }
  const out = normalizeMediaDraft(raw, boards, authors)
  assert.equal(out[0].author_name, '三缺一叫我')
  assert.equal(out[0].character_id, 7)
  assert.equal(out[0].author_type, 'character', '仍须标成 character（前端要打「角色」徽标）')
  assert.equal(out[1].author_name, '索菲亚_准星', '没填马甲应退回真名')
})

test('normalizeMediaDraft：同批网名跨帖子消歧，但角色马甲不动', () => {
  const boards = [{ id: 1, name: '日常' }]
  const authors = [{ id: 7, display_name: '阿米莉亚·冲锤', forum_alias: '楼下便利店', avatar_path: null }]
  const raw = { posts: [
    // 角色帖用了"楼下便利店"当马甲，紧接着两条评论也叫这个名
    { board: '日常', title: 'T1', content: 'C1', comments: [{ author: '楼下便利店', content: 'a' }, { author: '楼下便利店', content: 'b' }] },
    { board: '日常', title: 'T2', content: 'C2', author: '楼下便利店', comments: [] },
  ] }
  const out = normalizeMediaDraft(raw, boards, authors)

  // ★ 角色马甲必须原样保留 —— 它来自角色档案，是"同一个角色固定马甲"的权威值
  assert.equal(out[0].author_name, '楼下便利店')
  // 评论里的重名被消歧（保留内容，只加序号）
  assert.deepEqual(out[0].comments.map(c => c.author), ['楼下便利店2', '楼下便利店3'])
  // 匿名发帖人也参与同一套名字空间的消歧
  assert.equal(out[1].author_name, '楼下便利店4')
  assert.equal(out[1].author_type, 'anonymous')
  // 内容一条都没丢
  assert.equal(out.length, 2)
  assert.equal(out[0].comments.length, 2)
})

test('normalizeMediaDraft：没有角色参与时，匿名网名照样消歧', () => {
  const boards = [{ id: 1, name: '日常' }]
  const raw = { posts: [
    { board: '日常', title: 'T1', content: 'C1', author: '通勤中', comments: [{ author: '通勤中', content: 'a' }] },
  ] }
  const out = normalizeMediaDraft(raw, boards, [])
  assert.equal(out[0].author_type, 'anonymous')
  assert.equal(out[0].author_name, '通勤中')
  assert.equal(out[0].comments[0].author, '通勤中2')
})
