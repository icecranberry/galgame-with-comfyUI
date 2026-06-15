const BASE = '/api'

// ── Characters ──
export async function listCharacters() {
  const res = await fetch(`${BASE}/characters`)
  return res.json()
}

export async function getMessages(characterId) {
  const res = await fetch(`${BASE}/characters/${characterId}/messages`)
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

/** 预览模式生成角色：只生成不入库，由前端确认后再调 createCharacter */
export async function generateCharacterPreview(description) {
  const res = await fetch(`${BASE}/characters/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description, save: false }),
  })
  return res.json()
}

/** 直接创建角色（确认入库） */
export async function createCharacter(data) {
  const res = await fetch(`${BASE}/characters`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
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

export function chatStream(characterId, message, clientMsgId, forceImageGen = false) {
  const controller = new AbortController()
  const stream = new ReadableStream({
    async start(outerController) {
      // ── 健壮连接：fetch 异常 + 非 2xx 响应均重试（覆盖代理 ECONNRESET → 502 场景）──
      //    每次尝试带 8s 超时，防止 Vite proxy 挂起导致无限等待
      let res
      let retries = 0
      const MAX_RETRIES = 3
      while (true) {
        let timeoutId, onUserAbort
        const attemptCtrl = new AbortController()
        try {
          // 8s 超时：超时后走重试逻辑，保证连接断开场景下 8 秒内必有一次判决
          timeoutId = setTimeout(() => attemptCtrl.abort(new Error('timeout')), 8000)
          // 用户主动取消也中止本次尝试
          onUserAbort = () => attemptCtrl.abort()
          controller.signal.addEventListener('abort', onUserAbort, { once: true })

          res = await fetch(`${BASE}/characters/${characterId}/chat`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, client_msg_id: clientMsgId, force_image_gen: forceImageGen }),
            signal: attemptCtrl.signal,
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
        } finally {
          clearTimeout(timeoutId)
          if (onUserAbort) controller.signal.removeEventListener('abort', onUserAbort)
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

export async function updateLlmConfig(data) {
  const res = await fetch(`${BASE}/config/llm`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  return res.json()
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

// ── User Avatar ──
export async function getUserAvatar() {
  const res = await fetch(`${BASE}/config/user-avatar`)
  return res.json()
}

export async function uploadUserAvatar(base64) {
  const res = await fetch(`${BASE}/config/user-avatar`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base64 }),
  })
  return res.json()
}

// ── User config (nickname + persona) ──
export async function getUserConfig() {
  const res = await fetch(`${BASE}/config/user`)
  return res.json()
}

export async function updateUserConfig(data) {
  const res = await fetch(`${BASE}/config/user`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  return res.json()
}

// ── 测试画风（固定提示词，不存 DB；mode: 'chat' | 'moments'；prompt 可选覆盖默认）──
export async function testStyle(artist, width, height, mode = 'chat', prompt = '') {
  const body = { artist, width, height, mode };
  if (prompt) body.prompt = prompt;
  const res = await fetch(`${BASE}/images/test-style`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

// ── Moments 朋友圈 ──
export async function listMoments() {
  const res = await fetch(`${BASE}/moments`)
  return res.json()
}

/**
 * 连接朋友圈 SSE 推送流
 * @param {(post: object) => void} onNewPost 新帖回调
 * @returns {{ close: () => void }} 关闭函数，含 _closed 标记用于重连判断
 */
export function connectMomentsStream(onNewPost) {
  const controller = new AbortController()
  const conn = { _closed: false }

  conn.close = () => {
    conn._closed = true
    controller.abort()
  }

  fetch(`${BASE}/moments/stream`, { signal: controller.signal })
    .then(async (res) => {
      if (!res.ok) {
        console.warn('[api] moments SSE connection failed:', res.status)
        conn._closed = true
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        let done, value
        try {
          ({ done, value } = await reader.read())
        } catch { break }
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        let eventType = ''
        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim()
          } else if (line.startsWith('data: ') && eventType === 'new_post') {
            try {
              const post = JSON.parse(line.slice(6))
              onNewPost(post)
            } catch { /* ignore parse errors */ }
          }
        }
      }
      conn._closed = true
    })
    .catch(err => {
      conn._closed = true
      if (err.name !== 'AbortError') {
        console.warn('[api] moments SSE error:', err.message)
      }
    })

  return conn
}

export async function getMoment(id) {
  const res = await fetch(`${BASE}/moments/${id}`)
  return res.json()
}

export async function generateMoment(characterId) {
  const res = await fetch(`${BASE}/moments/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ character_id: characterId }),
  })
  return res.json()
}

export async function deleteMoment(id) {
  const res = await fetch(`${BASE}/moments/${id}`, { method: 'DELETE' })
  return res.json()
}

export async function commentMoment(postId, content) {
  const res = await fetch(`${BASE}/moments/${postId}/comments`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  })
  return res.json()
}

export async function deleteMomentComment(postId, commentId) {
  const res = await fetch(`${BASE}/moments/${postId}/comments/${commentId}`, { method: 'DELETE' })
  return res.json()
}

export async function likeMoment(postId) {
  const res = await fetch(`${BASE}/moments/${postId}/like`, { method: 'POST' })
  return res.json()
}

// ── ComfyUI health ──
export async function comfyuiHealth() {
  try {
    const res = await fetch(`${BASE}/images/comfyui-health`)
    return await res.json()
  } catch { return { connected: false } }
}

// ── Gallery 相册 ──
export async function listGalleryImages() {
  const res = await fetch(`${BASE}/images/gallery`)
  return res.json()
}
