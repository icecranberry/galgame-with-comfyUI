import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 「派系与组织」成员选择器：分类筛选 + 默认排除归档 —— 回归测试。
 *
 * ★★ 为什么值得钉（2026-10-07 用户要求）：
 *   ① 候选里混着 52 个归档角色，用户很难找到想加的人；
 *   ② **归档 = 禁止一切主动行为**，把归档角色拉进派系等于登记一个"不会动"的成员 ——
 *      用户看到的现象是"加进来了却毫无反应"（与红线 0 同源的静默失效）。
 *
 * ⚠ 两条不可回退：
 *   · 默认排除归档，但**必须可见地告知**"隐藏了 N 个"并给一键查看入口 ——
 *     不能让人以为角色丢了（红线 0）；
 *   · **已加入的归档成员必须继续显示在成员区**（带「已归档」角标）——
 *     "候选里默认隐藏"绝不能变成"已有成员也消失"。
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(HERE, '..', 'src')
const MODAL = path.join(SRC, 'components/FactionManagerModal.vue')
const TAVERN = path.join(SRC, 'views/TavernView.vue')

test('★★ 候选默认排除归档角色', () => {
  const src = fs.readFileSync(MODAL, 'utf8')
  assert.match(src, /pickScope = ref\('active'\)/, '默认分类应是「未归档」而不是全部')
  assert.match(src, /c\.archived\)\s*$|!c\.archived/, '候选筛选必须按 archived 过滤')
})

test('★★ 被隐藏的归档角色必须显式告知（不能让人以为角色丢了）', () => {
  const src = fs.readFileSync(MODAL, 'utf8')
  assert.match(src, /hiddenArchivedCount/, '应有"隐藏了多少归档角色"的计数')
  assert.match(src, /已隐藏/, '界面要说明被隐藏了')
  assert.match(src, /查看归档/, '要给一键跳到归档分类的入口')
})

test('★★ 已加入的归档成员仍要显示在成员区（带角标），不能被候选过滤连带隐藏', () => {
  const src = fs.readFileSync(MODAL, 'utf8')
  // 成员区（fl-mcard）用 current.members，不经过 pickList —— 这条断言防的是
  // "以后有人图省事把成员区也换成 pickList，导致归档成员从列表里消失"。
  const memberBlock = src.slice(src.indexOf('fl-mcards'), src.indexOf('fl-rels'))
  assert.match(memberBlock, /current\.members/, '成员区必须直接遍历 current.members')
  assert.ok(!/pickList/.test(memberBlock), '成员区不能被候选筛选影响')
  assert.match(memberBlock, /已归档/, '归档成员要有角标')
})

test('★★ 归档角色仍可被显式选中（默认隐藏 ≠ 禁止）', () => {
  const src = fs.readFileSync(MODAL, 'utf8')
  assert.match(src, /'archived'/, '要有「归档」分类可切过去')
  assert.match(src, /pickScope = 'archived'/, '要从提示里能一键切过去')
  // 归档候选不能被 disabled 掉（只有已在成员里的才 disabled）
  // ⚠ 切片要用**代码里真实出现的顺序**取：`fl-hidden-tip` 在网格**之前**，
  //   用它当终止锚点会切出空串（踩过）。
  const gridStart = src.indexOf('fl-pick-grid')
  const grid = src.slice(gridStart, src.indexOf('这个分类下没有角色'))
  assert.ok(grid.includes('v-for="c in pickList"'), '切片应覆盖候选按钮块')
  assert.match(grid, /:disabled="busy \|\| isMember\(c\.id\)"/, '归档角色不该被禁选')
  assert.match(grid, /已归档/, '归档候选要有角标，让用户知道自己在选什么')
})

test('★ 分类项要覆盖"未归档 + 各文件夹 + 归档"，且文件夹来自真实 store 口径', () => {
  const src = fs.readFileSync(MODAL, 'utf8')
  assert.match(src, /pickScopes/, '应有分类项计算')
  assert.match(src, /folder_id/, '按 folder_id 归类（与酒馆页/侧栏同一口径）')
  assert.match(src, /props\.folders/, '文件夹列表应由父组件传入')
})

test('★ 分类下无角色时必须给提示（不是空白一片）', () => {
  const src = fs.readFileSync(MODAL, 'utf8')
  assert.match(src, /这个分类下没有角色/, '空结果要说明原因')
})

test('★ TavernView 必须把 folders 传进来（否则分类只剩未归档/归档两档）', () => {
  const src = fs.readFileSync(TAVERN, 'utf8')
  const block = src.slice(src.indexOf('<FactionManagerModal'), src.indexOf('<FactionManagerModal') + 300)
  assert.match(block, /:folders="folders"/, '必须传入文件夹列表')
})