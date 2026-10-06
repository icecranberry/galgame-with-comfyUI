// 小镇特殊建筑「描述驱动的可执行玩法」API（docs/town-special-buildings-plan.md §10）。
// GET 全部只读；generate 是显式动作；执行统一携带服务端报价与幂等键。


const ROOT = '/api/town'

// 与 townLife.request 同一套错误语义；额外区分「后端未更新（404 HTML）」与「服务不可达」，
// 避免新接口在旧后端上被笼统报成「连接中断」。
async function request(path, body) {
  let response
  try {
    response = await fetch(`${ROOT}${path}`, body ? {
      method: body.__method || 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify((({ __method, ...rest }) => rest)(body)),
    } : { cache: 'no-store' })
  } catch (cause) {
    throw Object.assign(new Error('连不上后端服务：请确认 agent-core 正在运行、且页面地址与服务端口一致。'), {
      uncertain: true, cause,
    })
  }
  let data
  try {
    data = await response.json()
  } catch (cause) {
    // 非 JSON 响应（通常是旧后端的 404 HTML 页）：接口不存在
    throw Object.assign(new Error(
      response.status === 404
        ? '后端没有这个接口（404）：agent-core 还是旧版本，请重启后端服务（加载包含小镇特殊建筑功能的新代码）后再试。'
        : `后端返回了无法解析的响应（HTTP ${response.status}），请重启后端服务后再试。`),
      { uncertain: response.status >= 500, cause })
  }
  if (!response.ok || data?.ok === false || data?.error) {
    throw Object.assign(new Error(typeof data?.error === 'string' ? data.error : data?.message || '操作未完成'), {
      code: data?.code || data?.error, uncertain: response.status >= 500 || response.status === 408,
    })
  }
  return data
}

const buildingPath = locationKey => `/buildings/${encodeURIComponent(locationKey)}/features`

/** 只读：功能列表、状态与不可用原因；绝不触发 LLM/生图/扣费 */
export const fetchBuildingFeatures = (locationKey, mapId) =>
  request(`${buildingPath(locationKey)}${mapId != null ? `?mapId=${encodeURIComponent(mapId)}` : ''}`)

/** 显式生成/重生成（管理动作或玩家在管理页发起）；返回生成结果摘要 */
export const generateBuildingFeatures = (locationKey, { mapId, force } = {}) =>
  request(`${buildingPath(locationKey)}/generate`, { mapId, force: force === true })

/** 刷新店铺货架：固定 10 金币，重抽外观 + 商品目录并把货架补满（不限次数） */
export const refreshBuildingFeatureStock = (locationKey, { mapId } = {}) =>
  request(`${buildingPath(locationKey)}/refresh`, { mapId })

/** 读取生成状态（轮询用，不新建任务） */
export const fetchBuildingFeatureGeneration = (locationKey, mapId) =>
  request(`${buildingPath(locationKey)}/generation${mapId != null ? `?mapId=${encodeURIComponent(mapId)}` : ''}`)

/** 服务端报价：校验选择并返回报价收据（quoteId + 过期时间） */
export const quoteBuildingFeature = (locationKey, { worldId, worldEpoch, featureId, selection, mapId }) =>
  request(`${buildingPath(locationKey)}/quote`, { worldId, worldEpoch, mapId, featureId, selection: selection || {} })

/** 执行：真实结算（确定性）或开始生成（画像/纪念品），返回操作 */
export const executeBuildingFeature = (locationKey, { worldId, worldEpoch, mapId, featureId,
  profileRevision, quoteId, quoteExpiresAt, idempotencyKey, selection, eventId }) =>
  request(`${buildingPath(locationKey)}/execute`, { worldId, worldEpoch, mapId, featureId, profileRevision,
    quoteId, quoteExpiresAt, idempotencyKey: idempotencyKey || crypto.randomUUID(), selection: selection || {}, eventId })

export const fetchBuildingFeatureOperation = operationId =>
  request(`/building-feature-operations/${encodeURIComponent(operationId)}`)

/** 作品展示（gallery_display）：只读读取已有真实产物；服务端不建操作、不扣费 */
export const fetchBuildingFeatureGallery = (locationKey, { worldId, worldEpoch, mapId, featureId } = {}) =>
  request(`${buildingPath(locationKey)}/gallery?featureId=${encodeURIComponent(featureId || '')}`
    + `${mapId != null ? `&mapId=${encodeURIComponent(mapId)}` : ''}`
    + `${worldId != null ? `&worldId=${encodeURIComponent(worldId)}` : ''}`
    + `${worldEpoch != null ? `&worldEpoch=${encodeURIComponent(worldEpoch)}` : ''}`)
export const retryBuildingFeatureOperation = operationId =>
  request(`/building-feature-operations/${encodeURIComponent(operationId)}/retry`, {})
export const cancelBuildingFeatureOperation = operationId =>
  request(`/building-feature-operations/${encodeURIComponent(operationId)}/cancel`, {})
// ── 管理端 ──

export const fetchBuildingFeatureOverview = mapId =>
  request(`/buildings/features/overview${mapId != null ? `?mapId=${encodeURIComponent(mapId)}` : ''}`)
export const updateBuildingDescription = (locationKey, { mapId, description }) =>
  request(`/buildings/${encodeURIComponent(locationKey)}/description`, { mapId, description, __method: 'PUT' })
export const setBuildingFeatureEnabled = (locationKey, { mapId, enabled, manual } = {}) =>
  request(`${buildingPath(locationKey)}/enabled`, { mapId, enabled, manual })
