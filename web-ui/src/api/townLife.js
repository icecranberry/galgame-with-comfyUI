const ROOT = '/api/town'
// 功能建筑服务键：新增建筑只在这里登记一次，命令构造与校验同步生效。
const VENUE_SERVICE_KEYS = Object.freeze(['town.cafe.drink_coffee', 'town.cafe.work_shift',
  'town.tavern.shift', 'town.tavern.help_swap', 'town.tavern.buy_meal',
  'town.clothing.custom_order', 'town.clothing.shift',
  'town.inn.stay', 'town.inn.shift', 'town.study.lesson', 'town.study.shift'])
const PENDING_KEY = 'town-life-pending-v1'
const memoryPending = new Map()

async function request(path, body) {
  let response, data
  try {
    response = await fetch(`${ROOT}${path}`, body ? {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    } : { cache: 'no-store' })
    data = await response.json()
  } catch (cause) {
    throw Object.assign(new Error('连接中断，请先重新读取状态，再决定是否重试。'), { uncertain: true, cause })
  }
  if (!response.ok || data?.ok === false || data?.error) {
    throw Object.assign(new Error(typeof data?.error === 'string' ? data.error : data?.message || '操作未完成'), {
      code: data?.code || data?.error, uncertain: response.status >= 500 || response.status === 408,
    })
  }
  return data
}

export const getTownEconomy = () => request('/economy')
export const getTownLiquidity = () => request('/liquidity')
export const getTownServiceSession = sessionId => request(`/services/${encodeURIComponent(sessionId)}`)

/** Snapshot a command once. Retry this object verbatim; never add player IDs or coordinates. */
export function createTownLifeCommand(kind, { worldId, worldEpoch, orderId, expectedVersion, npcActorIds, locationKeys, sessionId, serviceKey, intentKey, text = '', businessKey } = {}) {
  if (!['setup', 'publish', 'accept', 'pickup', 'complete', 'cancel', 'service_offer', 'service_accept', 'service_cancel', 'service_turn'].includes(kind)) throw new Error('未知操作')
  if (!worldId || !Number.isSafeInteger(worldEpoch)) throw new Error('请先重新读取小镇状态')
  const body = { worldEpoch, idempotencyKey: crypto.randomUUID() }
  let path
  if (kind.startsWith('service_')) {
    if (kind === 'service_offer') {
      if (serviceKey !== undefined && !['town.workshop', 'town.workshop.bob_cut', ...VENUE_SERVICE_KEYS].includes(serviceKey)) throw new Error('未知小镇服务')
      path = '/services/offer'
      // Preserve the legacy request body and its server fingerprint, including explicit default selection.
      if (['town.workshop.bob_cut', ...VENUE_SERVICE_KEYS].includes(serviceKey)) body.serviceKey = serviceKey
    }
    else {
      if (!sessionId || !Number.isSafeInteger(expectedVersion)) throw new Error('请先重新读取工坊服务状态')
      body.expectedVersion = expectedVersion
      path = `/services/${encodeURIComponent(sessionId)}/${kind.slice(8)}`
      if (kind === 'service_turn') {
        if (!['choose_theme', 'confirm_materials', 'craft', 'deliver', 'clarify', 'choose_drink', 'serve', 'work', 'choose_style', 'confirm_order', 'take',
          'settle_in', 'rest_up', 'ask_lesson', 'take_lesson'].includes(intentKey) || typeof text !== 'string' || [...text].length > 500) throw new Error('无效服务选项或说明过长')
        body.intentKey = intentKey; body.text = text
      }
    }
  } else if (kind === 'setup') {
    body.npcActorIds = { commissioner: npcActorIds.commissioner, supplier: npcActorIds.supplier, workshop: npcActorIds.workshop }
    body.locationKeys = { board: locationKeys.board, supplier: locationKeys.supplier, workshop: locationKeys.workshop }
    // 功能建筑不再硬编码：选中了经营者与地点的额外角色键都随 setup 一起提交。
    const base = new Set(['commissioner', 'supplier', 'workshop'])
    for (const venue of Object.keys(npcActorIds || {}).filter(key => !base.has(key))) {
      if (npcActorIds?.[venue] && locationKeys?.[venue]) {
        body.npcActorIds[venue] = npcActorIds[venue]; body.locationKeys[venue] = locationKeys[venue]
      }
    }
    path = '/economy/setup'
  } else if (kind === 'publish') { if (businessKey === 'cafe') body.businessKey = 'cafe'; path = '/orders/publish' }
  else {
    if (!orderId || !Number.isSafeInteger(expectedVersion)) throw new Error('请先重新读取委托状态')
    body.expectedVersion = expectedVersion
    path = `/orders/${encodeURIComponent(orderId)}/${kind}`
  }
  return { kind, worldId, path, body }
}

export const executeTownLifeCommand = command => request(command.path, command.body)

/** Survives panel unmount/reopen and tab reload after a lost response. No automatic POST. */
export function getPendingTownLifeCommand(channel = 'life') {
  const key = channel === 'life' ? PENDING_KEY : `${PENDING_KEY}:${channel}`
  try {
    const saved = JSON.parse(sessionStorage.getItem(key) || 'null')
    if (saved?.body?.idempotencyKey && saved?.worldId && /^\/(economy\/setup|orders\/publish|orders\/[^/]+\/(accept|pickup|complete|cancel)|services\/offer|services\/[^/]+\/(accept|cancel|turn))$/.test(saved.path)) memoryPending.set(channel, saved)
  } catch { /* Storage may be unavailable; retain same-session memory. */ }
  return memoryPending.get(channel) || null
}
export function savePendingTownLifeCommand(command, channel = 'life') {
  const key = channel === 'life' ? PENDING_KEY : `${PENDING_KEY}:${channel}`
  memoryPending.set(channel, command)
  try {
    if (command) sessionStorage.setItem(key, JSON.stringify(command))
    else sessionStorage.removeItem(key)
  } catch { /* Memory fallback still protects close/reopen retries. */ }
}
