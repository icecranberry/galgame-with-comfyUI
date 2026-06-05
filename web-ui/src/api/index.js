const BASE = '/api'

// ── Conversations ──

export async function createConversation() {
  const res = await fetch(`${BASE}/conversations`, { method: 'POST' })
  return res.json()
}

export async function listConversations() {
  const res = await fetch(`${BASE}/conversations`)
  return res.json()
}

export async function getMessages(conversationId, { limit = 50, before } = {}) {
  const params = new URLSearchParams({ limit: String(limit) })
  if (before) params.set('before', String(before))
  const res = await fetch(`${BASE}/conversations/${conversationId}/messages?${params}`)
  return res.json()
}

export async function deleteConversation(id) {
  await fetch(`${BASE}/conversations/${id}`, { method: 'DELETE' })
}

export async function getEmotion(conversationId, characterId) {
  const params = characterId ? `?character_id=${characterId}` : ''
  const res = await fetch(`${BASE}/conversations/${conversationId}/emotion${params}`)
  return res.json()
}

/**
 * SSE 流式对话
 * @returns {ReadableStream} — call .getReader() to read SSE events
 */
export function chatStream(conversationId, message, characterId) {
  const controller = new AbortController()
  const body = JSON.stringify({ message, character_id: characterId })

  const stream = new ReadableStream({
    async start(outerController) {
      try {
        const res = await fetch(`${BASE}/conversations/${conversationId}/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          signal: controller.signal,
        })

        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) { outerController.close(); break }

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              const event = line.slice(7).trim()
              outerController.enqueue({ type: 'event', event })
            } else if (line.startsWith('data: ')) {
              const data = JSON.parse(line.slice(6))
              outerController.enqueue({ type: 'data', event: null, data })
            }
          }
        }
      } catch (err) {
        if (err.name !== 'AbortError') outerController.error(err)
      }
    },
  })

  return { stream, abort: () => controller.abort() }
}

// ── Characters ──

export async function listCharacters() {
  const res = await fetch(`${BASE}/characters`)
  return res.json()
}

export async function createCharacter(data) {
  const res = await fetch(`${BASE}/characters`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  return res.json()
}

export async function updateCharacter(id, data) {
  await fetch(`${BASE}/characters/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
}

export async function getCharacterEmotion(id, conversationId) {
  const params = conversationId ? `?conversation_id=${conversationId}` : ''
  const res = await fetch(`${BASE}/characters/${id}/emotion${params}`)
  return res.json()
}

export async function resetCharacterEmotion(id) {
  const res = await fetch(`${BASE}/characters/${id}/emotion/reset`, { method: 'POST' })
  return res.json()
}

// ── Memory ──

export async function searchMemory(q, { conversationId, topK } = {}) {
  const params = new URLSearchParams({ q })
  if (conversationId) params.set('conversation_id', conversationId)
  if (topK) params.set('top_k', String(topK))
  const res = await fetch(`${BASE}/memory/search?${params}`)
  return res.json()
}

export async function getMemoryFragments({ conversationId, type, limit } = {}) {
  const params = new URLSearchParams()
  if (conversationId) params.set('conversation_id', conversationId)
  if (type) params.set('type', type)
  if (limit) params.set('limit', String(limit))
  const res = await fetch(`${BASE}/memory/fragments?${params}`)
  return res.json()
}

export async function getEmotionHistory(conversationId, limit) {
  const params = new URLSearchParams()
  if (conversationId) params.set('conversation_id', conversationId)
  if (limit) params.set('limit', String(limit))
  const res = await fetch(`${BASE}/memory/emotion/history?${params}`)
  return res.json()
}

// ── Image Tasks ── (Phase 4)

export async function getImageTasks({ conversationId, status, limit } = {}) {
  const params = new URLSearchParams()
  if (conversationId) params.set('conversation_id', conversationId)
  if (status) params.set('status', status)
  if (limit) params.set('limit', String(limit))
  const res = await fetch(`${BASE}/images/tasks?${params}`)
  return res.json()
}
