import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * ★ 「编辑节点 Scene」必须是正式弹窗，不得回退成原生 `window.prompt`。
 *
 * ── 背景 ────────────────────────────────────────────────────
 * 2026-10-07 用户实报：故事页「大纲」里点节点上的「改」，弹的是浏览器原生
 * `window.prompt` 单行框 —— Scene 是一段多行叙述，在那种框里既看不全、也打不了
 * 换行，人类侧根本没法编辑。
 *
 * 原生 `window.prompt` / `window.confirm` 也没有主题、不能放上下文（改的是哪个
 * 节点）、不能显示字数与错误。改成了正式弹窗（StoryOutlineSceneModal）。
 *
 * ⚠ 本项目**允许** `window.confirm` 用于删除确认（全站一致的既有惯例），
 *   所以这里只钉 `window.prompt` —— 别把删除确认也一并禁掉。
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(HERE, '..', 'src')
const VIEW = path.join(SRC, 'views/StoryView.vue')
const MODAL = path.join(SRC, 'components/story/StoryOutlineSceneModal.vue')

/** 只看真实代码：整行注释里的 "window.prompt" 字样（解释"为什么不用它"）不算违规 */
function codeLines(src) {
  return src.split('\n').filter(line => !/^\s*(\/\/|\*|\/\*|<!--)/.test(line))
}

test('★★ 故事页不再用原生 window.prompt 改 Scene（改用正式弹窗）', () => {
  const src = fs.readFileSync(VIEW, 'utf8')
  const offenders = codeLines(src).filter(l => /window\.prompt/.test(l))
  assert.deepEqual(offenders, [],
    `StoryView.vue 仍在用 window.prompt（Scene 是多行内容，原生单行框编辑不了）：\n  ${offenders.join('\n  ')}`)
})

test('★ 编辑 Scene 的弹窗组件存在，且接了 v-model 与保存事件', () => {
  assert.ok(fs.existsSync(MODAL), 'StoryOutlineSceneModal.vue 应存在')
  const src = fs.readFileSync(MODAL, 'utf8')
  assert.match(src, /<linshe-modal/, '必须基于统一弹窗基座（LinsheModal）')
  assert.match(src, /type="textarea"/, 'Scene 是多行内容，必须用文本域而不是单行输入')
  assert.match(src, /emit\(['"]save['"]/, '必须向父级 emit save（写库由父级负责）')
  // 弹窗自身不碰 API：写库时机与状态都归 StoryView（避免两处状态源）
  assert.ok(!/from ['"]\.\.\/\.\.\/api/.test(src), '弹窗不应直接调 api（保持无状态，写库交给父级）')
})

test('★ StoryView 已挂载该弹窗，并把「改」按钮接到弹窗（而非直接写库）', () => {
  const src = fs.readFileSync(VIEW, 'utf8')
  assert.match(src, /<StoryOutlineSceneModal/, 'StoryView 模板里必须挂载该弹窗组件')
  assert.match(src, /import StoryOutlineSceneModal from/, '必须 import 该组件')
  // editScene 只负责开弹窗，不再同步写库
  const m = /async function editScene\([\s\S]*?\n\}/.exec(src)
  assert.ok(m, '应存在 editScene 函数')
  assert.match(m[0], /sceneEditOpen\.value = true/, 'editScene 应当只打开弹窗')
  assert.ok(!/updateStoryOutlineBeat/.test(m[0]), 'editScene 不应直接写库（改由 submitSceneEdit 负责）')
  // 真正的写库入口仍在，且走同一个后端接口
  assert.match(src, /async function submitSceneEdit\(/, '应有 submitSceneEdit 承担写库')
  assert.match(src, /updateStoryOutlineBeat\(/, 'submitSceneEdit 必须调用 updateStoryOutlineBeat')
})

test('★ 弹窗带上"改的是哪个节点"的上下文与快捷键提示', () => {
  const src = fs.readFileSync(MODAL, 'utf8')
  assert.match(src, /beat\.index/, '应显示节点序号（用户要知道自己在改哪一个）')
  assert.match(src, /Ctrl \+ Enter/, '应提示快捷键')
})