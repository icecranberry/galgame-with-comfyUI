import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  ENV_DIM_LABELS, ENV_DIM_ORDER, POSE_GROUP_KEY, POSE_GROUP_LABEL,
  envDimLabel, buildTagGroups,
} from '../src/utils/galleryEnvelopeLabels.js'

// 覆盖范围（规则34 左栏标签云改「按维度分组」）：
// 1) 环境标签按 payload.gallery.env[].dim 归组，不认识的标签落「体位 / 主题」
// 2) 体位组永远排最前（它是检索主键）
// 3) 每组独立截断 —— 这是重点：混排取前 N 会被体位名占满，新维度一个都露不出来
// 4) 脏数据（缺 payload / env 里是垃圾）不得让分组炸掉或丢标签

const mk = (tags, env) => ({ tags, payload: env ? { gallery: { env } } : undefined })

test('环境标签按维度归组，其余归「体位 / 主题」', () => {
  const posts = [
    mk(['后入', 'sex', 'bedroom', 'moonlight'], [
      { dim: 'scene', en: 'bedroom', cn: '卧室' },
      { dim: 'lighting', en: 'moonlight', cn: '月光' },
    ]),
  ]
  const groups = buildTagGroups(posts)
  const byKey = Object.fromEntries(groups.map(g => [g.key, g.items.map(i => i.name)]))
  assert.deepEqual(byKey[POSE_GROUP_KEY], ['后入', 'sex'])
  assert.deepEqual(byKey.scene, ['bedroom'])
  assert.deepEqual(byKey.lighting, ['moonlight'])
});

test('★ 体位组永远排最前（检索主键不能被环境维度顶掉）', () => {
  const posts = [mk(['后入', 'bedroom'], [{ dim: 'scene', en: 'bedroom', cn: '卧室' }])]
  assert.equal(buildTagGroups(posts)[0].key, POSE_GROUP_KEY)
  assert.equal(buildTagGroups(posts)[0].label, POSE_GROUP_LABEL)
});

test('★ 每组独立截断：体位名再多也不会把环境维度挤掉（旧实现只取全局前 26）', () => {
  // 造 40 个体位名（远超前 26）+ 每个维度各 1 个标签
  const poseTags = Array.from({ length: 40 }, (_, i) => `体位${i}`)
  const env = ENV_DIM_ORDER.map(d => ({ dim: d, en: `${d}-tag`, cn: 'x' }))
  const posts = [mk([...poseTags, ...env.map(e => e.en)], env)]

  const groups = buildTagGroups(posts, 12)
  const keys = groups.map(g => g.key)
  // 每个维度都必须有自己的组（这正是"看起来单一"的修法）
  for (const d of ENV_DIM_ORDER) assert.ok(keys.includes(d), `维度 ${d} 没成组`)
  assert.ok(keys.includes(POSE_GROUP_KEY))
  // 体位组被截到 12，但 total 记录真实数量
  const poseGroup = groups.find(g => g.key === POSE_GROUP_KEY)
  assert.equal(poseGroup.items.length, 12)
  assert.equal(poseGroup.total, 40)
  // 环境维度即使只有 1 个标签也必须露出来
  for (const d of ENV_DIM_ORDER) {
    assert.equal(groups.find(g => g.key === d).items.length, 1)
  }
});

test('不会丢标签：维度未知时也要出现在结果里（不静默吞掉）', () => {
  const posts = [mk(['某个没见过的标签'], [{ dim: 'unknown-dim', en: '某个没见过的标签', cn: 'x' }])]
  const groups = buildTagGroups(posts)
  const all = groups.flatMap(g => g.items.map(i => i.name))
  assert.ok(all.includes('某个没见过的标签'))
});

test('脏数据不炸：缺 payload / env 是垃圾 / tags 非数组', () => {
  assert.deepEqual(buildTagGroups(null), [])
  assert.deepEqual(buildTagGroups([{}]), [])
  assert.deepEqual(buildTagGroups([{ tags: 'not-an-array' }]), [])
  assert.deepEqual(buildTagGroups([{ tags: ['a'], payload: { gallery: { env: 'nope' } } }]), [
    { key: POSE_GROUP_KEY, label: POSE_GROUP_LABEL, items: [{ name: 'a', count: 1 }], total: 1 },
  ])
  // env 数组里混入 null / 缺字段的项 → 忽略，但标签照常归到体位组
  const groups = buildTagGroups([{ tags: ['a', 'b'], payload: { gallery: { env: [null, {}, { dim: 'scene' }] } } }])
  assert.equal(groups.length, 1)
  assert.deepEqual(groups[0].items.map(i => i.name).sort(), ['a', 'b'])
});

test('计数与排序：同组内按出现次数降序，同次数按名称排', () => {
  const posts = [
    mk(['x', 'y', 'scene-1'], [{ dim: 'scene', en: 'scene-1', cn: 'x' }]),
    mk(['x', 'y'], []),
    mk(['x'], []),
  ]
  const groups = buildTagGroups(posts)
  const pose = groups.find(g => g.key === POSE_GROUP_KEY)
  assert.deepEqual(pose.items.map(i => [i.name, i.count]), [['x', 3], ['y', 2]])
});

test('同一个标签在多条里被记到同一维度（取首个声明，不去重成两条）', () => {
  const env = [{ dim: 'scene', en: 'bedroom', cn: '卧室' }]
  const groups = buildTagGroups([mk(['bedroom'], env), mk(['bedroom'], env)])
  const scene = groups.find(g => g.key === 'scene')
  assert.equal(scene.items.length, 1)
  assert.equal(scene.items[0].count, 2)
});

test('维度显示名：已知维度有中文标签，未知维度回落 key（不显示 undefined）', () => {
  for (const d of ENV_DIM_ORDER) {
    assert.ok(ENV_DIM_LABELS[d], `维度 ${d} 缺显示名`);
    assert.equal(envDimLabel(d), ENV_DIM_LABELS[d]);
  }
  assert.equal(envDimLabel('some-new-dim'), 'some-new-dim')
});

test('ENV_DIM_ORDER 与 ENV_DIM_LABELS 的键一一对应（改一处漏一处会静默丢组）', () => {
  assert.deepEqual([...ENV_DIM_ORDER].sort(), Object.keys(ENV_DIM_LABELS).sort())
});
