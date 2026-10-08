import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_RATIO, ratioFromAspect, imageRatioOf, colsForWidth,
  cellHeightUnits, distributeColumns,
} from '../src/utils/galleryMasonry.js'

// 覆盖范围（规则34 缩略图改「按原比例完整展示」）：
// 1) 比例取值优先级：真实像素 > aspect 字符串 > 缺省 3:4
// 2) 坏 payload 必须被夹住（否则某格会被撑成天文高度 / 压成一条线）
// 3) 列数只有一份定义（视口 → 2/3/4），窄屏不至于把图缩到看不清
// 4) 瀑布流分列不丢项、不重复、长度恒等于列数

const withPx = (w, h) => ({ payload: { gallery: { width: w, height: h } } })
const withAspect = a => ({ payload: { gallery: { aspect: a } } })

test('ratioFromAspect：解析 "9:16" / "3：4"（全角）/ "4×3"，非法值返回 null', () => {
  assert.equal(ratioFromAspect('9:16'), 9 / 16)
  assert.equal(ratioFromAspect('16:9'), 16 / 9)
  assert.equal(ratioFromAspect('1:1'), 1)
  assert.equal(ratioFromAspect('4：3'), 4 / 3)     // 全角冒号
  assert.equal(ratioFromAspect('4×3'), 4 / 3)
  assert.equal(ratioFromAspect('3/4'), 3 / 4)
  for (const bad of ['', null, undefined, '竖幅', '0:0', '9', ':16', 'a:b']) {
    assert.equal(ratioFromAspect(bad), null, `"${bad}" 应判为非法`)
  }
})

test('imageRatioOf：真实像素优先，其次 aspect 字符串，最后缺省 3:4', () => {
  // 优先真实像素（服务端下发给生图器的就是这两个数，等于成图真实比例）
  assert.equal(imageRatioOf(withPx(972, 1728)), 972 / 1728)
  assert.equal(imageRatioOf(withPx(1728, 972)), 1728 / 972)

  // 只有 aspect 字符串时用它
  assert.equal(imageRatioOf(withAspect('16:9')), 16 / 9)

  // 两者都在 → 像素赢（即使字符串与之矛盾，也信像素）
  const both = { payload: { gallery: { width: 1200, height: 1600, aspect: '16:9' } } }
  assert.equal(imageRatioOf(both), 1200 / 1600)

  // 什么都没有 → 缺省竖幅（占位卡用，不能塌成 0 高）
  assert.equal(imageRatioOf({}), DEFAULT_RATIO)
  assert.equal(imageRatioOf(null), DEFAULT_RATIO)
  assert.equal(imageRatioOf({ payload: {} }), DEFAULT_RATIO)
});

test('imageRatioOf：坏 payload 被夹进安全区间（不会撑爆或压扁格子）', () => {
  // 极端竖幅：实际算出来是 0.02，必须被抬到下限
  assert.ok(imageRatioOf(withPx(20, 1000)) >= 0.25)
  // 极端横幅：实际 50，必须被压到上限
  assert.ok(imageRatioOf(withPx(5000, 100)) <= 4)
  // 0 / 负数 / NaN 一律回落缺省，而不是产出 NaN 宽度
  for (const bad of [withPx(0, 100), withPx(100, 0), withPx(-5, 100), withPx('x', 'y'), withPx(NaN, 100)]) {
    const r = imageRatioOf(bad)
    assert.ok(Number.isFinite(r) && r > 0, `坏值应回落，实得 ${r}`)
  }
})

test('colsForWidth：唯一列数定义处 —— 宽屏 4 / 中 3 / 窄 2，坏输入不返回 0', () => {
  assert.equal(colsForWidth(1920), 4)
  assert.equal(colsForWidth(1600), 4)
  assert.equal(colsForWidth(1401), 4)
  assert.equal(colsForWidth(1400), 3)
  assert.equal(colsForWidth(1200), 3)
  assert.equal(colsForWidth(1001), 3)
  assert.equal(colsForWidth(1000), 2)
  assert.equal(colsForWidth(375), 2)
  // ★ 列数绝不能是 0 或 NaN —— 那会让 grid-template-columns 整片失效
  for (const bad of [NaN, undefined, null, -1, 'abc']) {
    const n = colsForWidth(bad)
    assert.ok(Number.isInteger(n) && n >= 2, `colsForWidth(${bad}) = ${n}`)
  }
})

test('cellHeightUnits：竖幅比横幅高（瀑布流配平的量纲正确）', () => {
  const tall = cellHeightUnits(withPx(972, 1728))
  const wide = cellHeightUnits(withPx(1728, 972))
  const square = cellHeightUnits(withPx(1440, 1440))
  assert.ok(tall > square && square > wide, `竖${tall} 方${square} 横${wide} 顺序不对`)
})

test('distributeColumns：项目一条不丢、不重复，列数恒等于入参', () => {
  const items = Array.from({ length: 11 }, (_, i) => withPx(1000 + i, 1500))
  const cols = distributeColumns(items, 4)
  assert.equal(cols.length, 4)
  const flat = cols.flat()
  assert.equal(flat.length, items.length, '有项目丢失')
  assert.equal(new Set(flat.map(x => x.payload.gallery.width)).size, items.length, '有项目重复')
})

test('distributeColumns：塞最短列 —— 各列高度差收敛（这正是瀑布流的意义）', () => {
  // 混搭竖幅与横幅；若按"轮询分配"会严重失衡，按最短列则应接近配平
  const items = []
  for (let i = 0; i < 12; i++) items.push(i % 3 === 0 ? withPx(1728, 972) : withPx(972, 1728))
  const cols = distributeColumns(items, 4)
  const heights = cols.map(c => c.reduce((s, p) => s + cellHeightUnits(p), 0))
  const max = Math.max(...heights); const min = Math.min(...heights)
  // 允许一个格子的误差（贪心不保证最优，但必须在同一量级）
  assert.ok(max - min <= cellHeightUnits(withPx(972, 1728)) + 1e-9,
    `列高失衡过大：${heights.map(h => h.toFixed(2)).join(' / ')}`)
})

test('distributeColumns：确定性输出（同输入同输出，渲染不会抖动）', () => {
  const items = [withPx(900, 1600), withPx(1600, 900), withPx(1200, 1200), withPx(972, 1728)]
  const a = distributeColumns(items, 3).map(c => c.map(p => p.payload.gallery.width))
  const b = distributeColumns(items, 3).map(c => c.map(p => p.payload.gallery.width))
  assert.deepEqual(a, b)
})

test('distributeColumns：边界输入（空列表 / 0 列 / 1 列 / 缺列数）', () => {
  // 空列表 → 仍是 colCount 个空列（模板 v-for 不会炸）
  assert.deepEqual(distributeColumns([], 4).map(c => c.length), [0, 0, 0, 0])
  assert.deepEqual(distributeColumns(null, 2).map(c => c.length), [0, 0])
  // 0 / 非法列数 → 至少 1 列，绝不返回 []（返回空数组会让整片内容消失 = 红线）
  for (const bad of [0, -3, NaN, undefined, null, 'x']) {
    const cols = distributeColumns([withPx(1000, 1500)], bad)
    assert.equal(cols.length, 1, `distributeColumns(_, ${bad}) 应兜底成 1 列`)
    assert.equal(cols[0].length, 1, '兜底后项目仍须存在')
  }
  // 1 列 → 顺序原样保留
  const items = [withPx(1000, 1500), withPx(1200, 1500), withPx(1400, 1500)]
  const one = distributeColumns(items, 1)
  assert.equal(one.length, 1)
  assert.deepEqual(one[0].map(p => p.payload.gallery.width), [1000, 1200, 1400])
})
