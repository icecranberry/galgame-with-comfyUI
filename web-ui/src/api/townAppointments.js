const ROOT = '/api/town/appointments'
const STORAGE = 'town-appointment-pending-v1'
let memory = null
let storageWriteFailed = false
const errors = {
  SCHEDULE_UNAVAILABLE: '这个时段无法确认双方都有空，请选择其他时间。工作、休息和离镇安排优先。',
  APPOINTMENT_CONFLICT: '这个时段已有预约，请选择其他时间。', INVALID_APPOINTMENT_TIME: '请选择未来时间，并确保完整30分钟在邀请有效期内。',
  CANDIDATE_EXPIRED: '这份邀请已过期。', CANDIDATE_CLOSED: '这份邀请已处理，请查看最新预约。',
  VERSION_CONFLICT: '预约状态已变化，请重新读取。', STALE_EPOCH: '小镇已更新，请重新读取。',
  PROVIDER_NOT_LINKED: '这位居民暂时无法接受回访。', LOCATION_UNAVAILABLE: '回访地点暂时不可用。',
  APPOINTMENT_CLOSED: '这次预约已结束或取消。', ACTOR_UNAVAILABLE: '居民暂时无法参加回访。',
}
async function request(path = '', body) {
  let response, data
  try {
    response = await fetch(ROOT + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' })
    data = await response.json()
  } catch { throw Object.assign(new Error('连接中断，请重新读取。未确认的操作可沿用原请求重试。'), { uncertain: true }) }
  if (!response.ok || data?.error || data?.ok === false) throw Object.assign(new Error(errors[data?.code || data?.error] || '操作未完成，请重新读取最新状态。'), { uncertain: response.status >= 500 || response.status === 408 })
  return data
}
export async function getTownAppointments() {
  const data = await request()
  if (!data?.worldId || !Number.isSafeInteger(data.worldEpoch) || !Array.isArray(data.candidates) || !Array.isArray(data.appointments)) throw new Error('暂时无法读取回访记录。')
  return data
}
/** Parse the datetime-local value as UTC+08:00 regardless of browser time zone. */
export function parseTownAppointmentBeijingTime(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null
  const utc = Date.parse(`${value}:00+08:00`)
  if (!Number.isFinite(utc) || new Date(utc + 8 * 3600000).toISOString().slice(0, 16) !== value) return null
  return utc
}
export function createTownAppointmentCommand(kind, dto, startAt) {
  if (!['accept', 'cancel'].includes(kind) || !dto?.scope?.worldId || !Number.isSafeInteger(dto.scope.worldEpoch) || !Number.isSafeInteger(dto.version)) throw new Error('请先重新读取回访记录。')
  const id = kind === 'accept' ? dto.candidateId : dto.appointmentId
  if (typeof id !== 'string' || !id) throw new Error('请先重新读取回访记录。')
  const body = { worldEpoch: dto.scope.worldEpoch, expectedVersion: dto.version, idempotencyKey: crypto.randomUUID() }
  if (kind === 'accept') {
    if (!Number.isSafeInteger(startAt)) throw new Error('请选择回访时间。')
    body.startAt = startAt
  }
  return { kind, worldId: dto.scope.worldId, path: kind === 'accept' ? `/candidates/${encodeURIComponent(id)}/accept` : `/${encodeURIComponent(id)}/cancel`, body }
}
export const executeTownAppointmentCommand = command => request(command.path, command.body)
export function savePendingTownAppointment(command) {
  memory = command ? JSON.parse(JSON.stringify(command)) : null
  try { if (memory) sessionStorage.setItem(STORAGE, JSON.stringify(memory)); else sessionStorage.removeItem(STORAGE); storageWriteFailed = false } catch { storageWriteFailed = true }
}
export function loadPendingTownAppointment() {
  // Failed writes (including a failed removal) make the in-memory value authoritative.
  if (!storageWriteFailed) try { memory = JSON.parse(sessionStorage.getItem(STORAGE) || 'null') } catch { /* Use the same-session copy. */ }
  if (!memory?.worldId || !Number.isSafeInteger(memory.body?.worldEpoch) || !memory.body?.idempotencyKey || !/^\/(candidates\/[^/]+\/accept|[^/]+\/cancel)$/.test(memory.path)) return null
  return JSON.parse(JSON.stringify(memory))
}
