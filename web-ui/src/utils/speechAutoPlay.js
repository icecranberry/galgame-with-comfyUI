// Only live, committed sentences in the currently viewed conversation receive
// a one-use token. History loads and returning to a cached chat cannot replay it.
export function createSpeechAutoPlay() {
  let current, sequence = 0
  return {
    enter(scope, allowed) {
      const session = { scope, allowed, tokens: new Set(), seen: new Set() }
      current = session
      return () => {
        if (current !== session) return false
        current = null
        return true
      }
    },
    mark(scope, messageId) {
      if (current?.scope !== scope || !Number.isSafeInteger(messageId) || messageId <= 0 || current.seen.has(messageId)) return undefined
      current.seen.add(messageId)
      if (!current.allowed()) return undefined
      const token = ++sequence
      current.tokens.add(token)
      return token
    },
    claim(token) {
      if (!current?.tokens.delete(token)) return false
      return current.allowed()
    },
    clear() { current?.tokens.clear() },
  }
}
export const chatSpeechAutoPlay = createSpeechAutoPlay()
