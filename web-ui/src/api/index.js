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

export async function updateCharacter(id, data) {
  const res = await fetch(`${BASE}/characters/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  return res.json()
}

export async function clearMessages(characterId) {
  const res = await fetch(`${BASE}/characters/${characterId}/messages`, { method: 'DELETE' })
  return res.json()
}

export async function generateCharacter(description) {
  const res = await fetch(`${BASE}/characters/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description }),
  })
  return res.json()
}

export async function deleteCharacter(id) {
  const res = await fetch(`${BASE}/characters/${id}`, { method: 'DELETE' })
  return res.json()
}

export async function uploadAvatar(characterId, base64) {
  const res = await fetch(`${BASE}/characters/${characterId}/avatar`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base64 }),
  })
  return res.json()
}

export async function getRecentImages(characterId) {
  const res = await fetch(`${BASE}/characters/${characterId}/recent-images`)
  return res.json()
}

export function chatStream(characterId, message) {
  const controller = new AbortController()
  const stream = new ReadableStream({
    async start(outerController) {
      // ── 健壮连接：fetch 异常 + 非 2xx 响应均重试（覆盖代理 ECONNRESET → 502 场景）──
      let res
      let retries = 0
      const MAX_RETRIES = 3
      while (true) {
        try {
          res = await fetch(`${BASE}/characters/${characterId}/chat`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message }),
            signal: controller.signal,
          })
          if (res.ok) break  // 成功
          // 非 2xx：也按重试处理（代理 502/504 等）
          retries++
          if (retries > MAX_RETRIES) {
            outerController.error(new Error(`Server returned ${res.status}`))
            return
          }
          console.warn(`[api] bad status ${res.status} (${retries}/${MAX_RETRIES}), retrying in ${retries}s...`)
          await new Promise(r => setTimeout(r, retries * 1000))
        } catch (err) {
          if (err.name === 'AbortError') { outerController.close(); return }
          retries++
          if (retries > MAX_RETRIES) { outerController.error(err); return }
          console.warn(`[api] fetch failed (${retries}/${MAX_RETRIES}): ${err.message}, retrying in ${retries}s...`)
          await new Promise(r => setTimeout(r, retries * 1000))
        }
      }

      // ── 流式读取 ──
      try {
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

// ── Global Rules ──
export async function getGlobalRules() {
  const res = await fetch(`${BASE}/config/rules`)
  return res.json()
}

export async function updateGlobalRule(key, data) {
  const res = await fetch(`${BASE}/config/rules/${encodeURIComponent(key)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  })
  return res.json()
}

// ── ComfyUI health ──
export async function comfyuiHealth() {
  try {
    const res = await fetch(`${BASE}/images/comfyui-health`)
    return await res.json()
  } catch { return { connected: false } }
}
