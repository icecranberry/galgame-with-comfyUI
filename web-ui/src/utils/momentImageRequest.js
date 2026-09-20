const MOMENT_IMAGE_REQUEST_RE = /\[\[imgreq\]\]([\s\S]*?)(?:\[\[\/imgreq\]\]|$)/
const MOMENT_IMAGE_REQUEST_ALL_RE = /\[\[imgreq\]\][\s\S]*?(?:\[\[\/imgreq\]\]|$)/g

export function extractMomentImageRequest(content) {
  return String(content || '').match(MOMENT_IMAGE_REQUEST_RE)?.[1]?.trim() || ''
}

export function stripMomentImageRequest(content) {
  return String(content || '').replace(MOMENT_IMAGE_REQUEST_ALL_RE, '').trim()
}

export function appendMomentImageRequest(content, request) {
  const body = stripMomentImageRequest(content)
  const imageRequest = String(request || '').trim()
  if (!imageRequest) return body
  const marker = `[[imgreq]]${imageRequest}[[/imgreq]]`
  return body ? `${body}\n${marker}` : marker
}
