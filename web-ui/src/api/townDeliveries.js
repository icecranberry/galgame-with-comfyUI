const ROOT = '/api/town/deliveries'
const STORAGE = 'town-delivery-retry-v1'
let memory = null
let storageWriteFailed = false
const messages = { STALE_EPOCH: '小镇已更新，请重新读取。', DELIVERY_ACTIVE: '记录正在等待或处理中，请重新读取。', DELIVERY_DONE: '记录已完成，无需再次投递。', DELIVERY_NOT_FOUND: '记录已不可用，请重新读取。' }
async function request(query = '', body) {
  let response, data
  try {
    response = await fetch(ROOT + query, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' })
    data = await response.json()
  } catch { throw Object.assign(new Error('连接中断，请重新读取；结果未确认时可重试原请求。'), { uncertain: true }) }
  if (!response.ok || data?.error || data?.ok === false) throw Object.assign(new Error(messages[data?.code || data?.error] || '暂时无法处理记录，请重新读取后重试。'), { uncertain: response.status >= 500 || response.status === 408 })
  return data
}
export async function getTownDeliveries({ cursor = null, limit = 20 } = {}) {
  const query = new URLSearchParams({ limit: String(limit) })
  if (cursor) { query.set('cursorSeq', String(cursor.seq)); query.set('cursorConsumer', cursor.consumerKey) }
  const data = await request(`?${query}`)
  if (!data?.worldId || !Number.isSafeInteger(data.worldEpoch) || !Array.isArray(data.items)) throw new Error('记录读取失败，请重新读取。')
  return data
}
export function createTownDeliveryRetry(scope, item) {
  if (!scope?.worldId || !Number.isSafeInteger(scope.worldEpoch) || item?.status !== 'dead' || !item.eventId || !['town.experience', 'town.appointment'].includes(item.consumerKey)) throw new Error('请重新读取待处理记录。')
  return { worldId: scope.worldId, body: { worldEpoch: scope.worldEpoch, eventId: item.eventId, consumerKey: item.consumerKey, idempotencyKey: crypto.randomUUID() } }
}
export const executeTownDeliveryRetry = command => request('/retry', command.body)
export function savePendingTownDeliveryRetry(command) {
  memory = command ? JSON.parse(JSON.stringify(command)) : null
  try { if (memory) sessionStorage.setItem(STORAGE, JSON.stringify(memory)); else sessionStorage.removeItem(STORAGE); storageWriteFailed = false } catch { storageWriteFailed = true }
}
export function loadPendingTownDeliveryRetry() {
  // Failed writes (including a failed removal) make the in-memory value authoritative.
  if (!storageWriteFailed) try { memory = JSON.parse(sessionStorage.getItem(STORAGE) || 'null') } catch { /* Use same-session recovery. */ }
  if (!memory?.worldId || !Number.isSafeInteger(memory.body?.worldEpoch) || !memory.body?.eventId || !memory.body?.idempotencyKey || !['town.experience', 'town.appointment'].includes(memory.body.consumerKey)) return null
  return JSON.parse(JSON.stringify(memory))
}
