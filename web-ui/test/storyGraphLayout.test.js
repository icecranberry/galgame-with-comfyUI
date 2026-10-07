/**
 * 事件线节点图布局 —— 回归测试。
 *
 * ★ 为什么布局要单测：布局是**纯函数**，它的输出直接决定用户看到的图。
 *   已踩过的坑：随机布局每次刷新节点乱跳（用户手动摆好的心智地图作废）、
 *   聚簇把无关联的节点硬凑在一起（与"不造假关系"的取向矛盾）。
 *   这些都该由测试钉死，而不是靠肉眼验收。
 */

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  layoutStoryGraph, layerOfStage, LAYER_BAND_HEIGHT,
} from '../src/utils/storyGraphLayout.js'

const line = (id, stage, extra = {}) => ({ id, name: `线${id}`, stage, participantIds: [], places: [], ...extra })

test('★★★ 阶段即层：y 随阶段递增（起线→延展→成形→收束），图上一眼看出推进到哪', () => {
  const { positions } = layoutStoryGraph([
    line(1, '起线'), line(2, '延展'), line(3, '成形'), line(4, '收束'),
  ])
  const y = k => positions[String(k)].y
  assert.ok(y(1) < y(2), '起线应在延展之上')
  assert.ok(y(2) < y(3), '延展应在成形之上')
  assert.ok(y(3) < y(4), '成形应在收束之上（终态在底部）')
})

test('★ 收束与淡出同层（都是终态，不额外分层）', () => {
  assert.equal(layerOfStage('收束'), layerOfStage('淡出'))
  assert.equal(layerOfStage('起线'), 0)
  assert.equal(layerOfStage('延展'), 1)
  assert.equal(layerOfStage('成形'), 2)
})

test('★★ 未知阶段归到首层而不是抛错（一个怪值不该毁掉整张图）', () => {
  assert.equal(layerOfStage('莫名其妙'), 0)
  assert.equal(layerOfStage(''), 0)
  assert.equal(layerOfStage(null), 0)
  assert.doesNotThrow(() => layoutStoryGraph([line(1, '莫名其妙')]))
})

test('★★★ 确定性：同一输入必须得到同一坐标（否则每次刷新节点乱跳）', () => {
  const input = [
    line(5, '延展', { participantIds: [1] }),
    line(2, '延展', { participantIds: [1] }),
    line(9, '起线'),
  ]
  const a = layoutStoryGraph(input)
  const b = layoutStoryGraph([...input].reverse())   // 输入顺序颠倒
  assert.deepEqual(a.positions, b.positions, '坐标不应随输入顺序变化')
})

test('★★ 同层按关联聚簇：共享角色的线排在一起', () => {
  const { clusters, positions } = layoutStoryGraph([
    line(1, '延展', { participantIds: [7] }),
    line(2, '延展', { participantIds: [7] }),
    line(3, '延展', { participantIds: [99] }),   // 与 1/2 无关联
  ])
  // 1 与 2 应在同一簇，3 单独一簇
  const clusterWith1 = clusters.find(c => c.includes(1))
  assert.ok(clusterWith1.includes(2), '共享角色的两条线应聚在一起')
  assert.ok(!clusterWith1.includes(3), '无关联的线不应被硬凑进同一簇（不造假关系）')
  // 同簇节点 x 相邻：1 与 2 的 x 差应等于一个格
  const dx = Math.abs(positions['1'].x - positions['2'].x)
  assert.ok(dx <= 244.001, `同簇应相邻排布，实际间距 ${dx}`)
})

test('★★ 无关联的节点各自成簇，不被硬凑', () => {
  const { clusters } = layoutStoryGraph([
    line(1, '起线', { participantIds: [1] }),
    line(2, '起线', { participantIds: [2] }),
    line(3, '起线', { participantIds: [3] }),
  ])
  assert.equal(clusters.length, 3, '三个互不共享的线应各自成簇')
})

test('★★ 每个节点都必须有坐标（不得漏排 —— 漏排的节点在图上会消失）', () => {
  const nodes = Array.from({ length: 15 }, (_, i) => line(i + 1, '延展', { participantIds: [1] }))
  const { positions } = layoutStoryGraph(nodes)
  for (const n of nodes) {
    assert.ok(positions[String(n.id)], `节点 ${n.id} 必须有坐标`)
    assert.ok(Number.isFinite(positions[String(n.id)].x), `节点 ${n.id} 的 x 应是有限数`)
    assert.ok(Number.isFinite(positions[String(n.id)].y), `节点 ${n.id} 的 y 应是有限数`)
  }
})

test('★ 同层节点不重叠（间距不小于节点卡宽度下限）', () => {
  const { positions } = layoutStoryGraph([
    line(1, '起线'), line(2, '起线'), line(3, '起线'),
  ])
  const xs = [1, 2, 3].map(k => positions[String(k)].x).sort((a, b) => a - b)
  for (let i = 1; i < xs.length; i++) {
    assert.ok(xs[i] - xs[i - 1] >= 200, '同层相邻节点应留出足够横向间距')
  }
})

test('★ 折行不会与下一层重叠（层带高度足够容纳折行）', () => {
  const many = Array.from({ length: 13 }, (_, i) => line(i + 1, '起线'))  // 触发折行
  const layer0 = many.map(n => ({ ...n }))
  const one = layoutStoryGraph([...layer0, line(99, '延展')])
  const maxYlayer0 = Math.max(...layer0.map(n => one.positions[String(n.id)].y))
  assert.ok(maxYlayer0 < one.positions['99'].y, '起线层折行后仍不得压到延展层')
  assert.ok(maxYlayer0 - 40 <= LAYER_BAND_HEIGHT, '层内折行应被层带高度容纳')
})

test('★ 空输入 / 坏输入不抛错（返回空结果）', () => {
  assert.deepEqual(layoutStoryGraph([]), { positions: {}, clusters: [] })
  assert.deepEqual(layoutStoryGraph(null), { positions: {}, clusters: [] })
  assert.doesNotThrow(() => layoutStoryGraph([null, undefined, { name: '没id' }]))
})

test('★ 布局只管坐标，不做筛选（可见性是服务端的事）', () => {
  // 传入 5 个就必须排出 5 个 —— 不能自作主张过滤掉终态或别的
  const nodes = Array.from({ length: 5 }, (_, i) => line(i + 1, i % 2 ? '收束' : '起线'))
  const { positions } = layoutStoryGraph(nodes)
  assert.equal(Object.keys(positions).length, 5, '收到几个就排几个，不做筛选')
})