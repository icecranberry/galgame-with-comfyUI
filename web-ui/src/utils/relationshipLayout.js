export const characterKey = id => `character:${id}`

/** 拖入另一头像的圆形热区才建立关系，避开姓名和矩形容器的误命中。 */
export function findRelationshipDropTarget(dragged, nodes) {
  if (!dragged) return null
  let closest = null, nearestSquared = Infinity
  for (const node of nodes) {
    if (node.key === dragged.key) continue
    const distanceSquared = (node.x - dragged.x) ** 2 + (node.y - dragged.y) ** 2
    const reach = (node.radius || 32) + (dragged.radius || 32) * 0.45
    if (distanceSquared > reach ** 2) continue
    if (distanceSquared < nearestSquared || (distanceSquared === nearestSquared && node.key.localeCompare(closest.key) < 0)) {
      closest = node; nearestSquared = distanceSquared
    }
  }
  return closest
}

export function incidentRelationships(edges, key) {
  return key ? edges.filter(edge => edge.source === key || edge.target === key) : []
}

const compareIds = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true })

/** 多圈仅用于密集排版，与好感度、关系跳数无关。输入顺序不影响位置。 */
export function layoutRelationships(nodes, groups = [], compact = false) {
  const sorted = [...nodes].sort((a, b) => compareIds(a.id, b.id))
  const known = new Map(groups.map(group => [String(group.id), group.name]))
  const buckets = new Map()
  for (const node of sorted) {
    const key = node.group_id != null && known.has(String(node.group_id)) ? String(node.group_id) : 'unassigned'
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(node)
  }
  const sections = [...buckets].sort(([a], [b]) => a === 'unassigned' ? 1 : b === 'unassigned' ? -1 : compareIds(a, b))
  const count = sorted.length
  const lanes = count <= 8 ? 1 : count <= 32 ? 2 : count <= 72 ? 3 : 4
  const order = lanes === 1 ? [0] : lanes === 2 ? [0, 1] : lanes === 3 ? [0, 2, 1] : [0, 2, 1, 3]
  // 圈间 112px 留出头像与姓名；同圈相邻头像至少约 104px。
  const rowGap = compact ? 108 : 112
  const gap = sections.length > 1 ? Math.min(0.14, Math.PI / sections.length) : 0
  const usable = Math.PI * 2 - gap * sections.length
  let outerRadius = 160 + (lanes - 1) * rowGap
  // 分组末尾可能和下一组落在同一圈；按真实角距扩容，不依赖平均容量估算。
  const angles = []
  let start = -Math.PI / 2 - (sections[0]?.[1].length || 0) * usable / Math.max(count, 1) / 2
  for (const [groupId, members] of sections) {
    const span = members.length * usable / Math.max(count, 1)
    members.forEach((node, index) => angles.push({ node, groupId, lane: order[index % lanes], angle: start + (index + 0.5) * span / members.length }))
    start += span + gap
  }
  for (let lane = 0; lane < lanes; lane++) {
    const members = angles.filter(item => item.lane === lane).sort((a, b) => a.angle - b.angle)
    if (members.length < 2) continue
    for (let i = 0; i < members.length; i++) {
      const delta = (members[(i + 1) % members.length].angle - members[i].angle + Math.PI * 2) % (Math.PI * 2)
      outerRadius = Math.max(outerRadius, 104 / (2 * Math.sin(delta / 2)) + lane * rowGap)
    }
  }
  const positions = angles.map(({ node, groupId, lane, angle }) => ({ ...node, groupId, lane, angle,
    x: Math.cos(angle) * (outerRadius - lane * rowGap), y: Math.sin(angle) * (outerRadius - lane * rowGap),
  }))
  start = -Math.PI / 2 - (sections[0]?.[1].length || 0) * usable / Math.max(count, 1) / 2
  const labels = sections.map(([id, members]) => {
    const span = members.length * usable / Math.max(count, 1)
    const angle = start + span / 2
    start += span + gap
    return { id, name: known.get(id) || '未分配居室', count: members.length,
      x: Math.cos(angle) * (outerRadius + 88), y: Math.sin(angle) * (outerRadius + 88) }
  })
  return { nodes: positions, groups: labels, radii: Array.from({ length: lanes }, (_, lane) => outerRadius - lane * rowGap), radius: outerRadius + 128 }
}

/** ID 命名空间区分用户、角色和两种关系表，保留方向，不推断逆向文本。 */
export function normalizeRelationshipGraph(data) {
  const nodes = (data.nodes || []).map(node => ({ ...node, key: characterKey(node.id) }))
  const ids = new Set(nodes.map(node => node.key))
  const edges = (data.edges || []).map(edge => ({ ...edge, key: `relation:${edge.id}`, kind: 'character',
    source: characterKey(edge.from_character_id), target: characterKey(edge.to_character_id) }))
  const userEdges = (data.userEdges || []).map(edge => ({ ...edge, key: `user-relation:${edge.id}`, kind: 'user',
    source: 'user', target: characterKey(edge.character_id) }))
  return { nodes, groups: data.groups || [], edges: [...edges, ...userEdges].filter(edge =>
    edge.source !== edge.target && edge.relationship_text?.trim()
    && (edge.source === 'user' || ids.has(edge.source)) && ids.has(edge.target)) }
}

export function scopeRelationshipGraph(graph, center = 'user') {
  if (center === 'user') return graph
  const edges = graph.edges.filter(edge => edge.source === center || edge.target === center)
  const related = new Set(edges.flatMap(edge => [edge.source, edge.target]))
  return { ...graph, nodes: graph.nodes.filter(node => node.key === center || related.has(node.key)), edges }
}

/** 曲线聚束用于全网；中心辐射与双向弧线用于阅读，端点停在头像边缘。 */
export function relationshipCurve(source, target, bundled = false) {
  const dx = target.x - source.x, dy = target.y - source.y
  const distance = Math.hypot(dx, dy) || 1
  const ux = dx / distance, uy = dy / distance
  const start = { x: source.x + ux * (source.radius || 32), y: source.y + uy * (source.radius || 32) }
  const end = { x: target.x - ux * ((target.radius || 32) + 8), y: target.y - uy * ((target.radius || 32) + 8) }
  const bend = Math.min(50, distance * 0.13)
  const a = Math.atan2(source.y, source.x), b = Math.atan2(target.y, target.x)
  const delta = Math.atan2(Math.sin(b - a), Math.cos(b - a))
  // 沿较短圆弧聚束，让外圈角色关系绕过中心的“我”。
  const routeRadius = Math.max(150, Math.min(Math.hypot(source.x, source.y), Math.hypot(target.x, target.y)) * 0.72)
  const c1 = bundled ? { x: Math.cos(a + delta / 3) * routeRadius, y: Math.sin(a + delta / 3) * routeRadius } : { x: start.x + dx * 0.32 - uy * bend, y: start.y + dy * 0.32 + ux * bend }
  const c2 = bundled ? { x: Math.cos(b - delta / 3) * routeRadius, y: Math.sin(b - delta / 3) * routeRadius } : { x: end.x - dx * 0.32 - uy * bend, y: end.y - dy * 0.32 + ux * bend }
  return `M ${start.x} ${start.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${end.x} ${end.y}`
}
