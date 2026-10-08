import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * ★ 剧情大纲的生成模块必须是**字段化编辑器**，不是只读草稿预览。
 *
 * ── 背景 ────────────────────────────────────────────────────
 * 2026-10-07 用户原话：「大纲生成我不是很满意，我觉得你的生成功能模块应该
 * 类似于线列表的新建事件线」—— 即照 `StoryView.vue` 的「新建事件线」弹窗做：
 * 顶部「✨ 让 AI 按要点生成」（先选角色/地点，生成时一并带上）→ 逐字段可编辑
 * → 确认后点「保存」才落库。
 *
 * ★★ 两条最容易回退的语义，本测试钉死：
 *   ① **只出草稿不落库** —— 弹窗组件自身不调 API 写库，写库归 StoryView
 *      （与 StoryOutlineSceneModal 同构：弹窗只收集/编辑，状态单一来源）。
 *   ② **未改动的节点必须原样回传原文块**（`raw`）—— 只有标了 `dirty` 的节点
 *      才给 `value` 交由服务端重新序列化；否则会吃掉模型将来多给的字段。
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(HERE, '..', 'src')
const VIEW = path.join(SRC, 'views/StoryView.vue')
const MODAL = path.join(SRC, 'components/story/StoryOutlineEditorModal.vue')
const API = path.join(SRC, 'api/index.js')

const read = p => fs.readFileSync(p, 'utf8')

/** 只看真实代码：整行注释/模板注释不算违规 */
function codeLines(src) {
  return src.split('\n').filter(line => !/^\s*(\/\/|\*|\/\*|<!--)/.test(line))
}

test('★★ 编辑器组件存在且基于统一弹窗基座', () => {
  assert.ok(fs.existsSync(MODAL), 'StoryOutlineEditorModal.vue 应存在')
  const src = read(MODAL)
  assert.match(src, /<linshe-modal/, '必须基于统一弹窗基座（LinsheModal）')
  assert.match(src, /defineProps/, '应有 props 契约')
  assert.match(src, /emit\(['"]saved['"]/, '保存必须 emit 给父级（由 StoryView 独占写库）')
})

test('★★★ 弹窗自身**不写库**（写库归 StoryView，状态单一来源）', () => {
  const src = read(MODAL)
  // 组件可以调"只读取数"和"生成草稿"，但**不得**调用任何保存/落库接口
  const saveCalls = codeLines(src).filter(l => /saveStoryOutline|saveStoryOutlineEditor|updateStoryOutlineBeat|deleteStoryOutlineBeat|clearStoryOutline/.test(l))
  assert.deepEqual(saveCalls, [],
    `弹窗不应自己写库（应由父级 submitOutlineEditor 负责）：\n  ${saveCalls.join('\n  ')}`)
})

test('★★★ 未改动节点必须原样回传 raw，只有 dirty 的才给 value（保住"不重新序列化"）', () => {
  const src = read(MODAL)
  const m = /function submit\(\)[\s\S]*?\n\}/.exec(src)
  assert.ok(m, '应存在 submit 函数')
  const body = m[0]
  assert.match(body, /n\.raw/, 'submit 必须在未改动时回传原文块 raw')
  assert.match(body, /n\.dirty/, 'submit 必须按 dirty 区分"改过 / 没改过"')
  assert.match(body, /\{\s*value\s*\}|value\s*:/, '改动过的节点应给 value（由服务端序列化）')
})

test('★★★ 编辑器载荷来自 /outline/editor（含 prefix/suffix/blocks/separator），而不是前端自己解析 raw', () => {
  const src = read(MODAL)
  assert.match(src, /getStoryOutlineEditor\(/, '必须走 /outline/editor 取数')
  // prefix / suffix / separator 要原样留着（拼回时回传）
  for (const k of ['prefix', 'suffix', 'separator']) {
    assert.ok(new RegExp(`${k}\\.value`).test(src), `编辑器必须回传 ${k}（否则拼回不可能逐字节一致）`)
  }
  // blocks 用于给每个节点配上原文块（`toNode(beat, blocks[i])`）
  assert.match(src, /ed\.blocks/, '必须从载荷里取每个节点的原文块')
  assert.match(src, /toNode\(b, blocks\[i\]|blocks\[i\]\s*\|\|/, '每个节点应带上对应原文块')
  // ★ 前端不得自己解析 raw（会把"保留未知字段"的活儿做丢）
  assert.ok(!/\.raw\b[\s\S]{0,40}\.split\(/.test(src), '不应在前端自己切 raw')
})

test('★★ 生成与细化都不落库，且细化只改一个节点', () => {
  const src = read(MODAL)
  assert.match(src, /generateStoryOutline\(/, '应接生成草稿接口')
  assert.match(src, /refineStoryOutlineBeat\(/, '应接单节点重写接口')
  const m = /async function runRefine\(\)[\s\S]*?\n\}/.exec(src)
  assert.ok(m, '应存在 runRefine 函数')
  assert.ok(!/saveStory/.test(m[0]), '重写不得落库')
  assert.match(m[0], /nodes\.value\[i\]/, '重写只回填该节点')
})

test('★★★ StoryView 挂载了编辑器，且旧只读草稿弹窗已移除', () => {
  const src = read(VIEW)
  assert.match(src, /<StoryOutlineEditorModal/, 'StoryView 模板里必须挂载字段化编辑器')
  assert.match(src, /import StoryOutlineEditorModal from/, '必须 import 该组件')
  assert.match(src, /submitOutlineEditor/, '必须有 submitOutlineEditor 承担写库')
  assert.match(src, /saveStoryOutlineEditor\(/, 'submitOutlineEditor 必须调用 /outline/editor')
  // 旧的只读草稿弹窗（outlineDraft / outlineDirection / runOutlineGenerate / saveOutlineDraft）应已退役
  assert.ok(!/outlineDraft/.test(src), '旧的只读草稿状态 outlineDraft 应已移除')
  assert.ok(!/outlineDirection/.test(src), '旧的走向提示状态 outlineDirection 应已移除')
  assert.ok(!/function saveOutlineDraft/.test(src), 'saveOutlineDraft 应已退役')
})

test('★★ 「新建事件线」那套上下文入口被复用到编辑器（角色/地点多选）', () => {
  const src = read(MODAL)
  assert.match(src, /MultiPickSelect/, '应复用 MultiPickSelect（与「新建事件线」同一组件）')
  assert.match(src, /输入角色名检索/, '应有角色检索口径')
  assert.match(src, /输入地名检索/, '应有地点检索口径')
  assert.match(src, /先选好角色\/地点，生成时会一并带上/, '应有与「新建事件线」一致的提示文案')
})

test('★★ 编辑器不得用原生 window.prompt（与「编辑节点 Scene」同一口径）', () => {
  const src = read(MODAL)
  const offenders = codeLines(src).filter(l => /window\.prompt/.test(l))
  assert.deepEqual(offenders, [], `不应使用原生 window.prompt：\n  ${offenders.join('\n  ')}`)
})

test('★★ 底部操作区与「新建事件线」同形：取消 / 保存', () => {
  const src = read(MODAL)
  // 用户给的参考图底部就是「取消」+「保存」，取消不落库（直接关掉，丢弃未保存编辑）
  assert.match(src, /取消/, '底部应有「取消」按钮（与参考图一致）')
  assert.match(src, /open = false/, '取消应只是关闭弹窗，不触发写库')
  assert.match(src, /@click="submit"|@click="submit\(\)"/, '保存应走 submit')
})

test('★★ 前端 API 已补齐字段化编辑器的三个接口', () => {
  const src = read(API)
  assert.match(src, /export function getStoryOutlineEditor/, '应导出 getStoryOutlineEditor')
  assert.match(src, /export function refineStoryOutlineBeat/, '应导出 refineStoryOutlineBeat')
  assert.match(src, /export function saveStoryOutlineEditor/, '应导出 saveStoryOutlineEditor')
  assert.match(src, /\/story\/outline\/editor/, '应指向 /story/outline/editor')
  assert.match(src, /\/story\/outline\/beat\/refine/, '应指向 /story/outline/beat/refine')
})