import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * 日记本的两个「静默失败」契约（都是线上真踩过的坑）：
 *
 * 1. 组件模板引用了 store 没暴露的成员 → 渲染期抛错，整个日记本浮层一个节点都不渲染，
 *    页面其它部分照常，控制台一条异常，肉眼只看到「点了没反应」。
 *    （历史事实：DiaryBookOverlay 调用 store.todayKey()，而 store 的 return 里没有它。）
 * 2. 后端 broadcast 的事件没登记进 unifiedStream 的转发清单 → 前端静默丢弃，
 *    生成完成了书里也不更新。
 */

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')

/** 抽出 setup store 的 return { ... } 里暴露的成员名 */
function storeExposedKeys(src) {
  const start = src.lastIndexOf('return {')
  assert.ok(start > 0, 'diary store 应有 return 块')
  const body = src.slice(start + 'return {'.length)
  const end = body.indexOf('}')
  assert.ok(end > 0, 'diary store 的 return 块应有收尾')
  return body.slice(0, end)
    .split(',')
    .map(s => s.trim().split(':')[0].trim())
    .filter(Boolean)
}

test('DiaryBookOverlay 只引用 diary store 真实暴露的成员', () => {
  const exposed = new Set(storeExposedKeys(read('../src/stores/diary.js')))
  const overlay = read('../src/components/DiaryBookOverlay.vue')

  const referenced = [...overlay.matchAll(/\bstore\.([A-Za-z_$][\w$]*)/g)].map(m => m[1])
  const missing = [...new Set(referenced)].filter(key => !exposed.has(key))
  assert.deepEqual(missing, [], `日记本引用了 store 未暴露的成员：${missing.join(', ')}`)

  // todayKey 是组件外直接 import 用的，必须留在 store 模块的导出面上
  assert.match(read('../src/stores/diary.js'), /export function todayKey/)
  assert.match(overlay, /import \{ useDiaryStore, todayKey \} from '\.\.\/stores\/diary\.js'/)
})

test('日程页的日记入口、卡底入口栏与 App 宿主都在位', () => {
  const schedule = read('../src/views/ScheduleView.vue')
  assert.match(schedule, /@diary="onOpenDiary\(c\)"/, '角色卡片要能直接翻开日记本')
  assert.match(schedule, /@diary="onOpenDiary\(detailChar\)"/, '详情抽屉要有日记入口')
  assert.match(schedule, /diaryStore\.openBook\(\{/, '入口必须走 diary store 的 openBook')

  // 卡片入口：从卡片下沿伸出来的一条（hover / 触摸展开），不再是右上角图标按钮
  const card = read('../src/components/CharacterStatusCard.vue')
  assert.match(card, /class="card-diary-bar"/, '卡片入口是卡片下方那一条')
  assert.match(card, /\.card-diary-bar\s*\{[^}]*top:\s*calc\(100% - 18px\)/, '这条要插进卡片里面（顶边高过卡底一个圆角半径），卡片底角让出来的空间才由它填满')
  assert.match(card, /\.card-diary-bar\s*\{[^}]*z-index:\s*-1/, '这一条的层级要在卡片之后，否则接缝处会盖住卡片')
  assert.match(card, /transform: translateY\(calc\(-1 \* var\(--diary-height\)\)\)/, '日记条从卡面后方滑出')
  assert.match(card, /transform: translateY\(0\)/, '展开后日记条回到卡底位置')
  assert.match(card, /\.card-diary-bar\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--bg-secondary\)/, '这一条用实色（不透明），别用半透明——会和卡面毛玻璃叠出深一层')
  assert.doesNotMatch(card, /\.card-diary-bar\s*\{[^}]*background:\s*(rgba|transparent)/, '这一条背景不能是带透明度的颜色')
  assert.match(card, /is-diary-revealed/, '触摸端要有非 hover 的展开标记')
  assert.doesNotMatch(card, /class="diary-btn"/, '右上角旧的日记图标按钮应已移除')
  assert.match(card, /<diary-icon/)
  // 卡面必须在 .card-inner 上：日记入口是它的兄弟节点，负 z-index 才真的落到卡面之后
  assert.match(card, /background: linear-gradient\(var\(--glass-bg\), var\(--glass-bg\)\), var\(--bg-primary\)/, '卡面用实色底托住玻璃色，遮住背后的日记条')

  // 抽屉入口：单独占满一行
  const drawer = read('../src/components/CharacterDetailDrawer.vue')
  assert.match(drawer, /<diary-icon/)
  assert.match(drawer, /class="dr-diary-row"/, '抽屉里的日记按钮要独立成行')
  assert.match(drawer, /\.dr-diary-row\s*\{[^}]*width:\s*100%/, '抽屉日记按钮要占满宽度')

  const app = read('../src/App.vue')
  assert.match(app, /<DiaryBookOverlay \/>/, '日记本宿主挂在 App 上，任何页面都能打开')

  // 右下角生成提示：日记任务复用 image_edit_task_* 通道
  const floater = read('../src/components/ImageEditTaskFloater.vue')
  assert.match(floater, /function isDiary\(task\)/)
  assert.match(floater, /onViewDiary/)
})

test('日记本内页是「文字 + 图片交错」的一条流，用多栏均分两列', () => {
  const overlay = read('../src/components/DiaryBookOverlay.vue')
  assert.match(overlay, /buildDiaryFlow\(/, '版面必须走 buildDiaryFlow 交错编排')
  assert.match(overlay, /class="diary-flow"/)
  assert.match(overlay, /\.diary-flow\s*\{[^}]*columns:\s*2/, '内页用两栏排版')
  assert.match(overlay, /\.photo-card\s*\{[^}]*break-inside:\s*avoid/, '配图不能跨栏断开')
  // 不再是「左页正文 / 右页配图」两页式
  assert.doesNotMatch(overlay, /book-page-left/)
  assert.doesNotMatch(overlay, /class="page-photos"/)
})

test('diary_* 事件同时登记进 unifiedStream 转发清单与 diary store 订阅', () => {
  const stream = read('../src/stores/unifiedStream.js')
  const store = read('../src/stores/diary.js')
  for (const evt of ['diary_start', 'diary_progress', 'diary_text_ready', 'diary_done', 'diary_error']) {
    assert.match(stream, new RegExp(`${evt}:`), `${evt} 必须在 unifiedStream 的转发清单里，否则前端静默丢弃`)
    assert.match(store, new RegExp(`onEvent\\('${evt}'`), `${evt} 必须被 diary store 订阅`)
  }
})
