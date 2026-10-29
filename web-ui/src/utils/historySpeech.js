/** Preserve raw transcript text while attaching the persisted bubble IDs to its sentences. */
export function historySpeechLines(message) {
  const text = message.content || ''
  const lines = []
  let cursor = 0, searchFrom = 0
  // Streaming splits can drop line breaks inside paired punctuation.
  const offsets = [], compact = text.split('').filter((char, index) => {
    if (/\s/.test(char)) return false
    offsets.push(index); return true
  }).join('')
  if (message.role === 'assistant') {
    for (const segment of message.speech_segments || []) {
      if (!Number.isSafeInteger(segment.id) || segment.id <= 0 || !segment.content) continue
      const needle = segment.content.replace(/\s/g, '')
      if (!needle) continue
      const start = compact.indexOf(needle, searchFrom)
      if (start < 0) continue
      searchFrom = start + needle.length
      let end = offsets[searchFrom - 1] + 1
      // Bubble storage strips sentence separators; keep them before the icon.
      const punctuation = /^[。，！？…～~,.!?；;：:]+/.exec(text.slice(end))
      if (punctuation) end += punctuation[0].length
      lines.push({ text: text.slice(cursor, end), messageId: segment.id })
      cursor = end
    }
  }
  if (cursor < text.length) lines.push({ text: text.slice(cursor), messageId: null })
  return lines
}
