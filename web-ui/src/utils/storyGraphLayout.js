/**
 * 事件线节点图的**布局计算**（纯函数，可单测）—— T2 第二期。
 *
 * ── 为什么要自己写布局 ──────────────────────────────────────
 * 项目装了 `@vue-flow/core`（画布）但**没有装自动布局库**（dagre / elkjs 都没有）。
 * 为一件小事引一个布局依赖不划算，且布局规则本身承载了业务语义
 * （"阶段即层"是这张图要传达的第一信息），交给通用布局反而会打散它。
 * 故这里自写：**分层（layered）**布局。
 *
 * ── 布局规则（对应用户设计文档 §2.2）────────────────────────
 * 1. **阶段即层**：起线 → 延展 → 成形 → 收束/淡出，`y` 随阶段递增。
 *    这样"这条线推进到哪了"一眼可见 —— 也是构画阶段机在视觉上的落点。
 * 2. **同层按关联聚簇**：共享角色/地点的线排在一起，簇内相邻。
 *    ⚠ 只在**同层内**聚簇，不做跨层力导向 —— 力导向结果每次不同、不便于对照，
 *      而"人工编辑的图应该是稳定的"。
 * 3. **确定性**：同一份输入必然得到同一份坐标（无随机）。
 *    否则用户每次刷新页面节点都会乱跳，人工摆好的心智地图就废了。
 *
 * ⚠ 本模块**只管坐标**，不做任何筛选/裁剪 —— 可见性是服务端的事
 *   （"选节点 + 算边"必须原子，见 `eventLineService.filterLinesForGraph`）。
 *   这里收到什么就画什么。
 */

/** 层间距（纵向）：够放两行节点卡 + 连线标签 */
const LAYER_GAP_Y = 132
/** 同层节点横向间距 */
const NODE_GAP_X = 244
/** 起始坐标（留出画布边距，fitView 会再居中） */
const ORIGIN_X = 60
const ORIGIN_Y = 40
/** 每层最多折行数（超过就换行，避免一层排成一条过长直线） */
const MAX_PER_ROW = 6

/**
 * 阶段 → 层号。**唯一真源在服务端**（`LINE_STAGES`），这里的映射只是空间换算，
 * 不改动阶段语义；遇未知阶段归到最后一层（不抛错 —— 一个怪值不该毁掉整张图）。
 * @param {string} stage
 * @returns {number}
 */
export function layerOfStage(stage) {
  const s = String(stage || '').trim()
  if (s === '起线') return 0
  if (s === '延展') return 1
  if (s === '成形') return 2
  if (s === '收束' || s === '淡出') return 3
  return 0
}

/**
 * 两节点之间的"关联强度" —— 用于同层聚簇排序。
 *
 * ⚠ 只数**结构性事实**（共享角色/地点的个数），与后端算边同源，
 *   不做语义相似推断（用户裁定 S3）。
 */
function affinity(a, b) {
  const sharedChars = (a.participantIds || []).filter(x => (b.participantIds || []).includes(x)).length
  const sharedPlaces = (a.places || []).filter(x => (b.places || []).includes(x)).length
  return sharedChars * 2 + sharedPlaces
}

/**
 * 把节点按"阶段分层 + 同层聚簇"排成确定性的坐标。
 *
 * @param {Array<object>} nodes 事件线对象（含 id/stage/participantIds/places/derivedFrom）
 * @returns {{ positions: Record<string,{x:number,y:number}>, clusters: Array<Array<string|number>> }}
 */
export function layoutStoryGraph(nodes = []) {
  const list = (Array.isArray(nodes) ? nodes : []).filter(n => n && n.id != null)
  // 先按 id 升序固定顺序 —— 保证确定性（DB 返回顺序变了也不会让图跳）
  const sorted = [...list].sort((a, b) => Number(a.id) - Number(b.id))

  // 分层
  const layers = new Map()
  for (const n of sorted) {
    const k = layerOfStage(n.stage)
    if (!layers.has(k)) layers.set(k, [])
    layers.get(k).push(n)
  }

  const positions = {}
  const clusters = []

  for (const k of [...layers.keys()].sort((a, b) => a - b)) {
    const group = layers.get(k)
    // 同层聚簇：从第一个未访问节点出发，反复吸收与其关联最强且>0 的节点。
    // 关联为 0 的节点各自成簇 —— 不硬凑（与后端"无共享就不连边"同一取向）。
    const remaining = new Set(group.map(n => String(n.id)))
    const byId = new Map(group.map(n => [String(n.id), n]))
    const groups = []
    while (remaining.size) {
      const seedId = [...remaining].sort()[0]      // 取 id 最小者做种子，保证确定性
      const cluster = [byId.get(seedId)]
      remaining.delete(seedId)
      let grew = true
      while (grew) {
        grew = false
        // 找当前簇内任一节点关联度最高的未访问节点
        let best = null; let bestScore = 0
        for (const id of remaining) {
          const cand = byId.get(id)
          const score = cluster.reduce((m, c) => Math.max(m, affinity(c, cand)), 0)
          if (score > bestScore) { bestScore = score; best = id }
        }
        if (best && bestScore > 0) {
          cluster.push(byId.get(best))
          remaining.delete(best)
          grew = true
        }
      }
      groups.push(cluster)
    }
    // 聚簇之间也按确定性顺序（首个成员的 id）排列
    groups.sort((a, b) => Number(a[0].id) - Number(b[0].id))

    // 铺坐标：同层横向排；超过 MAX_PER_ROW 折到下一行（行内仍属同一"层带"）
    let cursorX = 0
    let row = 0
    let inRow = 0
    for (const cluster of groups) {
      clusters.push(cluster.map(n => n.id))
      for (const n of cluster) {
        if (inRow >= MAX_PER_ROW) { inRow = 0; row += 1; cursorX = 0 }
        positions[String(n.id)] = {
          x: ORIGIN_X + cursorX * NODE_GAP_X,
          // 每层给足 3 行的空间，避免折行后压到下一层
          y: ORIGIN_Y + k * (LAYER_GAP_Y * 3) + row * LAYER_GAP_Y,
        }
        cursorX += 1
        inRow += 1
      }
    }
  }

  return { positions, clusters }
}

/** 层带高度（供外部在画布上画"阶段泳道"参考线；与布局同源，避免两处各写一份） */
export const LAYER_BAND_HEIGHT = LAYER_GAP_Y * 3
export { LAYER_GAP_Y, NODE_GAP_X, MAX_PER_ROW }