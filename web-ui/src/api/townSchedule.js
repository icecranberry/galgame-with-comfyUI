/** Read-only accepted appointments; never ensures or regenerates a base schedule. */
export async function getTownScheduleOverlays(characterId, { signal, limit = 20 } = {}) {
  if (!Number.isSafeInteger(Number(characterId)) || Number(characterId) < 1) throw new Error('请选择角色。')
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) throw new Error('回访记录数量无效。')
  const response = await fetch(`/api/schedule/${Number(characterId)}/overlays?limit=${limit}`, { cache: 'no-store', signal })
  if (!response.ok) throw new Error('回访安排暂时无法读取。')
  const data = await response.json()
  if (Number(data?.characterId) !== Number(characterId) || !Array.isArray(data.appointments) || typeof data.timeZone !== 'string') throw new Error('回访安排暂时无法读取。')
  // Disabled/uninitialized worlds may return an empty list without a world scope.
  if (data.appointments.length && (!data.worldId || !Number.isSafeInteger(data.worldEpoch))) throw new Error('回访安排暂时无法读取。')
  return data
}

export function formatTownScheduleTime(utcMs, timeZone) {
  if (!Number.isSafeInteger(utcMs)) return '时间待确认'
  try {
    return new Intl.DateTimeFormat('zh-CN', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(utcMs)
  } catch { return '时间待确认' }
}
