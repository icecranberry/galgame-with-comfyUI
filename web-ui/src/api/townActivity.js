/** Read-only activity feed. Cursor is the server's opaque pagination position. */
export async function getTownActorActivities(actorId, { cursor = 0, limit = 10, signal } = {}) {
  if (typeof actorId !== 'string' || !actorId) throw new Error('请先选择居民')
  const query = new URLSearchParams({ cursor: String(cursor), limit: String(limit) })
  try {
    const response = await fetch(`/api/town/actors/${encodeURIComponent(actorId)}/activities?${query}`, { cache: 'no-store', signal })
    const data = await response.json()
    if (!response.ok || data?.error) throw new Error('读取失败，请稍后重新读取。')
    if (data?.actorId !== actorId || !Array.isArray(data.activities) || !Array.isArray(data.experiences) || data.worldId == null || data.worldEpoch == null) throw new Error('居民记录已变化，请重新读取。')
    return data
  } catch (error) {
    if (error.name === 'AbortError') throw error
    throw new Error('暂时无法读取居民记录，请重新读取。')
  }
}
