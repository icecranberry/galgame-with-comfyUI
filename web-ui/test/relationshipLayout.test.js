import test from 'node:test'
import assert from 'node:assert/strict'
import { findRelationshipDropTarget, incidentRelationships, layoutRelationships, normalizeRelationshipGraph, scopeRelationshipGraph, relationshipCurve } from '../src/utils/relationshipLayout.js'

const nodes = count => Array.from({ length: count }, (_, i) => ({ id: i + 1, key: `character:${i + 1}`, display_name: i < 2 ? '同名角色' : `角色${i + 1}`, group_id: i % 3 }))
const groups = [{ id: 0, name: '第一间居室' }, { id: 1, name: '名称很长的第二间居室' }, { id: 2, name: '第三间居室' }, { id: 3, name: '空居室' }]

test('头像重合选择最近的另一个角色，空白、自己、姓名矩形区域不误创建', () => {
  const a = { key: 'a', x: 0, y: 0, radius: 32 }, b = { key: 'b', x: 100, y: 0, radius: 32 }
  const center = { key: 'user', x: 200, y: 0, radius: 50 }
  assert.equal(findRelationshipDropTarget(null, [a, b]), null)
  assert.equal(findRelationshipDropTarget(a, [a, b]), null)
  assert.equal(findRelationshipDropTarget({ ...a, x: 100, y: 64 }, [a, b]), null)
  assert.equal(findRelationshipDropTarget({ ...a, x: 90 }, [a, b, center]).key, 'b')
  assert.equal(findRelationshipDropTarget({ ...a, x: 160 }, [a, b, center]).key, 'user')
  assert.equal(findRelationshipDropTarget({ ...a, x: 300 }, [a, b, center]), null)
})

test('悬停角色包含全网入向、出向和用户关系，不包含无关连线或推断的反向描述', () => {
  const edges = [
    { source: 'a', target: 'b', relationship_text: '老板' },
    { source: 'b', target: 'a', relationship_text: '下属' },
    { source: 'c', target: 'a', relationship_text: '同学' },
    { source: 'user', target: 'a', relationship_text: '邻居' },
    { source: 'b', target: 'c', relationship_text: '朋友' },
  ]
  assert.deepEqual(incidentRelationships(edges, 'a').map(edge => edge.relationship_text), ['老板', '下属', '同学', '邻居'])
  assert.deepEqual(incidentRelationships(edges, 'isolated'), [])
  assert.deepEqual(incidentRelationships(edges, ''), [])
})

test('多圈确定性布局不受最近聊天顺序、重名和空组影响', () => {
  const source = nodes(48)
  const a = layoutRelationships(source, groups), b = layoutRelationships([...source].reverse(), groups)
  assert.deepEqual(a, b)
  assert.equal(a.radii.length, 3)
  assert.equal(a.groups.length, 3)
  assert.equal(new Set(a.nodes.map(node => node.id)).size, 48)
})

test('空图、小样本、密集分组与窄屏均无非有限坐标或头像重叠', () => {
  for (const count of [0, 1, 2, 8, 9, 18, 32, 33, 72, 73, 132, 300]) {
    for (const compact of [false, true]) {
      for (const source of [nodes(count), nodes(count).map((node, i) => ({ ...node, group_id: i < 5 ? i : 0 }))]) {
        const layout = layoutRelationships(source, groups, compact)
        assert.ok(Number.isFinite(layout.radius))
        for (const node of layout.nodes) {
          assert.ok(Number.isFinite(node.x) && Number.isFinite(node.y))
          assert.ok(Math.hypot(node.x, node.y) >= 160 - 0.001)
        }
        for (let i = 0; i < layout.nodes.length; i++) {
          for (let j = i + 1; j < layout.nodes.length; j++) {
            const a = layout.nodes[i], b = layout.nodes[j]
            assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 103.9, `overlap N=${count}: ${a.id}/${b.id}`)
          }
        }
      }
    }
  }
})

test('总览包含孤立角色和全网边，角色图只包含入向/出向与用户相关边', () => {
  const graph = normalizeRelationshipGraph({ nodes: nodes(5), groups,
    edges: [
      { id: 1, from_character_id: 1, to_character_id: 2, relationship_text: '老板' },
      { id: 2, from_character_id: 2, to_character_id: 1, relationship_text: '下属' },
      { id: 3, from_character_id: 3, to_character_id: 2, relationship_text: '同学' },
      { id: 4, from_character_id: 1, to_character_id: 99, relationship_text: '缺失' },
      { id: 5, from_character_id: 1, to_character_id: 1, relationship_text: '自身' },
      { id: 6, from_character_id: 1, to_character_id: 3, relationship_text: '  ' },
    ], userEdges: [{ id: 1, character_id: 1, relationship_text: '邻居' }] })
  assert.equal(scopeRelationshipGraph(graph).nodes.length, 5)
  assert.equal(graph.edges.length, 4)
  assert.equal(new Set(graph.edges.map(edge => edge.key)).size, 4)
  const focused = scopeRelationshipGraph(graph, 'character:1')
  assert.deepEqual(focused.nodes.map(node => node.id), [1, 2])
  assert.deepEqual(focused.edges.map(edge => edge.relationship_text), ['老板', '下属', '邻居'])
  assert.deepEqual(scopeRelationshipGraph(graph, 'character:5').nodes.map(node => node.id), [5])
})

test('双向弧线互不重叠，缺少逆向关系时不构造虚假数据', () => {
  const a = { x: 0, y: 0, radius: 50 }, b = { x: 300, y: 0, radius: 32 }
  assert.notEqual(relationshipCurve(a, b), relationshipCurve(b, a))
  assert.ok(!/NaN|Infinity/.test(relationshipCurve(a, a)))
  const graph = normalizeRelationshipGraph({ nodes: nodes(2), edges: [{ id: 1, from_character_id: 1, to_character_id: 2, relationship_text: '老板' }] })
  assert.equal(graph.edges.length, 1)
  assert.equal(graph.edges[0].source, 'character:1')
})
