const READ_KEY = 'linshe.media.last_seen'
const FEED_CATEGORIES = ['digital', 'social']
const validId = value => Number.isSafeInteger(value) && value >= 0 ? value : 0

export function readMediaSeen(storage) {
  try {
    const saved = JSON.parse((storage || globalThis.localStorage)?.getItem(READ_KEY) || '{}')
    return Object.fromEntries(FEED_CATEGORIES.map(key => [key, validId(saved?.[key])]))
  } catch {
    return { digital: 0, social: 0 }
  }
}

/** Only acknowledge content actually returned by a successful category-list request. */
export function markMediaSeen(seen, category, postId, storage) {
  if (!FEED_CATEGORIES.includes(category) || !validId(postId)) return seen
  const stored = readMediaSeen(storage)
  const next = Object.fromEntries(FEED_CATEGORIES.map(key => [key, Math.max(
    validId(seen[key]), stored[key], key === category ? postId : 0
  )]))
  try { (storage || globalThis.localStorage)?.setItem(READ_KEY, JSON.stringify(next)) } catch { /* private mode */ }
  return next
}

export function mediaCategoryUnread(latest, seen, newspaperUnread) {
  return {
    traditional: !!newspaperUnread,
    digital: validId(latest.digital) > validId(seen.digital),
    social: validId(latest.social) > validId(seen.social)
  }
}

export function chooseMediaCategory(categories, unread, random = Math.random) {
  const pending = categories.filter(key => unread[key])
  const choices = pending.length ? pending : categories
  return choices[Math.floor(random() * choices.length)]
}
