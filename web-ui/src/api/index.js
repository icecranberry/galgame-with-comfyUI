const BASE = '/api'

// ── Characters ──
export async function listCharacters() {
  const res = await fetch(`${BASE}/characters`)
  return res.json()
}

export async function getMessages(characterId, { limit = 50, before } = {}) {
  const params = new URLSearchParams({ limit: String(limit) })
  if (before) params.set('before', String(before))
  const res = await fetch(`${BASE}/characters/${characterId}/messages?${params}`)
  return res.json()
}

export function chatStream(characterId, message) {
  const controller = new AbortController()
  const stream = new ReadableStream({
    async start(outerController) {
      try {
        const res = await fetch(`${BASE}/characters/${characterId}/chat`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message }),
          signal: controller.signal,
        })
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        let lastEvent = null

        while (true) {
          const { done, value } = await reader.read()
          if (done) { outerController.close(); break }
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              lastEvent = line.slice(7).trim()
              outerController.enqueue({ type: 'event', event: lastEvent })
            } else if (line.startsWith('data: ')) {
              try {
                const data = JSON.parse(line.slice(6))
                outerController.enqueue({ type: 'data', event: lastEvent, data })
              } catch { /* ignore parse errors */ }
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

// ── Config ──
export async function getConfig() {
  const res = await fetch(`${BASE}/config`)
  return res.json()
}

export async function updateComfyConfig(data) {
  await fetch(`${BASE}/config/comfy`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  })
}

export async function updateFeatureFlag(key, value) {
  await fetch(`${BASE}/config/features`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key, value }),
  })
}

// ── ComfyUI health ──
export async function comfyuiHealth() {
  try {
    const res = await fetch(`${BASE}/images/comfyui-health`)
    return await res.json()
  } catch { return { connected: false } }
}
