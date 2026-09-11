/** Only reads formal task cards; accepting remains a town command at the notice board. */
export async function getTownMailboxTasks({ cursor, limit = 10, signal } = {}) {
  const query = new URLSearchParams({ limit: String(limit) })
  if (cursor != null) query.set('cursor', JSON.stringify(cursor))
  const response = await fetch(`/api/town/mailbox-tasks?${query}`, { cache: 'no-store', signal })
  const data = await response.json()
  if (!response.ok || data?.error || !Array.isArray(data?.items)) throw new Error('小镇委托暂时无法读取，请稍后再试。')
  return data
}
