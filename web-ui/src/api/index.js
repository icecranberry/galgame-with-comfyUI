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

export async function undoLastRound(characterId) {
  const res = await fetch(`${BASE}/characters/${characterId}/messages/last-round`, { method: 'DELETE' })
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

/** AI 生成角色头像（脸部特写，表情跟随人格） */
export async function generateAvatar(characterId) {
  const res = await fetch(`${BASE}/characters/${characterId}/generate-avatar`, {
    method: 'POST',
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `Avatar generation failed (${res.status})`)
  }
  return res.json()
}

// ── Character Relationships ──
export async function getRelationships(characterId) {
  const res = await fetch(`${BASE}/relationships?character_id=${characterId}`)
  return res.json()
}

export async function createRelationship(from_character_id, to_character_id, relationship_text) {
  const res = await fetch(`${BASE}/relationships`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from_character_id, to_character_id, relationship_text }),
  })
  return res.json()
}

export async function updateRelationship(id, relationship_text) {
  const res = await fetch(`${BASE}/relationships/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ relationship_text }),
  })
  return res.json()
}

export async function deleteRelationship(id) {
  const res = await fetch(`${BASE}/relationships/${id}`, { method: 'DELETE' })
  return res.json()
}

// ── User Relationships ──
export async function getUserRelationships() {
  const res = await fetch(`${BASE}/user-relationships`)
  return res.json()
}

export async function createUserRelationship(character_id, relationship_text) {
  const res = await fetch(`${BASE}/user-relationships`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ character_id, relationship_text }),
  })
  return res.json()
}

export async function updateUserRelationship(id, relationship_text) {
  const res = await fetch(`${BASE}/user-relationships/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ relationship_text }),
  })
  return res.json()
}

export async function deleteUserRelationship(id) {
  const res = await fetch(`${BASE}/user-relationships/${id}`, { method: 'DELETE' })
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

/** 更新主动聊天频率 0~1 */
export async function updateProactiveFreq(value) {
  await fetch(`${BASE}/config/proactive-freq`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value }),
  })
}

/** 更新奇遇触发频率 0~1 */
export async function updateEventFreq(value) {
  await fetch(`${BASE}/config/event-freq`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value }),
  })
}

/** 更新防打扰模式总开关 */
export async function updateDisturbMode(value) {
  const res = await fetch(`${BASE}/config/disturb-mode`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value }),
  })
  return res.json()
}

/** 更新防打扰时间段和角色列表 */
export async function updateDisturbSettings(data) {
  const res = await fetch(`${BASE}/config/disturb-settings`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  })
  return res.json()
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

/** 获取单条规则的默认值（不修改，仅供预览） */
export async function getDefaultRule(key) {
  const res = await fetch(`${BASE}/config/rules/${encodeURIComponent(key)}/default`)
  return res.json()
}

/** 重置单条全局规则为默认值 */
export async function resetGlobalRule(key) {
  const res = await fetch(`${BASE}/config/rules/${encodeURIComponent(key)}/reset`, {
    method: 'POST',
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

/**
 * 连接主动聊天 SSE 推送流
 * @param {(data: object) => void} onProactiveMessage 新主动消息回调
 * @returns {{ close: () => void }} 关闭函数，含 _closed 标记用于重连判断
 */
export function connectNotificationsStream(onProactiveMessage) {
  const controller = new AbortController()
  const conn = { _closed: false }

  conn.close = () => {
    conn._closed = true
    controller.abort()
  }

  fetch(`${BASE}/notifications/stream`, { signal: controller.signal })
    .then(async (res) => {
      if (!res.ok) {
        console.warn('[api] notifications SSE connection failed:', res.status)
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
          } else if (line.startsWith('data: ') && eventType === 'proactive_message') {
            try {
              const data = JSON.parse(line.slice(6))
              onProactiveMessage(data)
            } catch { /* ignore parse errors */ }
          }
        }
      }
      conn._closed = true
    })
    .catch(err => {
      conn._closed = true
      if (err.name !== 'AbortError') {
        console.warn('[api] notifications SSE error:', err.message)
      }
    })

  return conn
}

/** 获取有未读主动消息的角色列表 */
export async function getProactiveUnread() {
  const res = await fetch(`${BASE}/notifications/unread`)
  return res.json()
}

/** 标记某角色的主动消息已读 */
export async function markProactiveRead(characterId) {
  await fetch(`${BASE}/notifications/mark-read/${characterId}`, { method: 'POST' })
}

/** 调试：强制随机角色发起一次主动聊天 */
export async function forceProactive() {
  const res = await fetch(`${BASE}/notifications/force-proactive`, { method: 'POST' })
  return res.json()
}

export async function getMoment(id) {
  const res = await fetch(`${BASE}/moments/${id}`)
  return res.json()
}

/** 获取朋友圈未读计数 */
export async function getMomentsUnread() {
  const res = await fetch(`${BASE}/moments/unread-count`)
  return res.json()
}

/** 清零朋友圈未读计数 */
export async function markMomentsRead() {
  const res = await fetch(`${BASE}/moments/mark-read`, { method: 'POST' })
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

// ── 角色对用户的画像（user_portraits）──
export async function getCharacterPortrait(characterId) {
  const res = await fetch(`${BASE}/portraits/${characterId}`)
  return res.json()
}

export async function addPortrait(characterId, traitType, content) {
  const res = await fetch(`${BASE}/portraits`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ characterId, traitType, content }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || '添加失败')
  }
  return res.json()
}

export async function updatePortrait(id, content) {
  const res = await fetch(`${BASE}/portraits/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || '更新失败')
  }
  return res.json()
}

export async function deletePortrait(id) {
  const res = await fetch(`${BASE}/portraits/${id}`, { method: 'DELETE' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || '删除失败')
  }
  return res.json()
}

// ── ComfyUI health ──
export async function comfyuiHealth() {
  try {
    const res = await fetch(`${BASE}/images/comfyui-health`)
    return await res.json()
  } catch { return { connected: false } }
}

// ── Gift 送礼 ──
export async function sendGift(characterId, giftType) {
  const res = await fetch(`${BASE}/characters/${characterId}/gift`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ giftType }),
  })
  return res.json()
}

export async function getGiftCooldowns() {
  const res = await fetch(`${BASE}/characters/gift/cooldowns`)
  return res.json()
}

export async function resetGiftCooldowns() {
  const res = await fetch(`${BASE}/characters/gift/cooldowns`, { method: 'DELETE' })
  return res.json()
}

// ── Gallery 相册 ──
export async function listGalleryImages(limit = 100, offset = 0) {
  const res = await fetch(`${BASE}/images/gallery?limit=${limit}&offset=${offset}`)
  return res.json()
}

// ── 画师串收藏夹 ──
export async function getArtistFavorites() {
  const res = await fetch(`${BASE}/config/artist-favorites`)
  return res.json()
}

export async function addArtistFavorite({ label, artist }) {
  const res = await fetch(`${BASE}/config/artist-favorites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ label, artist }),
  })
  return res.json()
}

export async function updateArtistFavorite(id, data) {
  const res = await fetch(`${BASE}/config/artist-favorites/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  return res.json()
}

export async function deleteArtistFavorite(id) {
  const res = await fetch(`${BASE}/config/artist-favorites/${id}`, {
    method: 'DELETE',
  })
  return res.json()
}

// ── Events 奇遇 ──
export async function listEvents() {
  const res = await fetch(`${BASE}/events`)
  return res.json()
}

export async function getActiveEvent(characterId) {
  const res = await fetch(`${BASE}/events/active/${characterId}`)
  return res.json()
}

export async function getEventById(eventId) {
  const res = await fetch(`${BASE}/events/by-id/${eventId}`)
  if (!res.ok) return null
  return res.json()
}

export async function chooseEventOption(eventId, choice, customText) {
  // 120s 超时：LLM (~15s) + ComfyUI 生图 (~90s) 的总耗时上限
  // 避免请求无限挂起耗尽浏览器 HTTP/1.1 连接池（6 连接限制 + 3 SSE = 仅剩 3 可用）
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 120_000)
  try {
    const res = await fetch(`${BASE}/events/${eventId}/choose`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ choice, customText }),
      signal: controller.signal,
    })
    return res.json()
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function dismissEvent(eventId) {
  const res = await fetch(`${BASE}/events/${eventId}/dismiss`, { method: 'POST' })
  return res.json()
}

export async function concludeEvent(eventId) {
  const res = await fetch(`${BASE}/events/${eventId}/conclude`, { method: 'POST' })
  return res.json()
}

export async function deleteEvent(eventId) {
  const res = await fetch(`${BASE}/events/${eventId}`, { method: 'DELETE' })
  return res.json()
}

export async function getEventsUnread() {
  const res = await fetch(`${BASE}/events/unread-count`)
  return res.json()
}

export async function markEventsRead() {
  const res = await fetch(`${BASE}/events/mark-read`, { method: 'POST' })
  return res.json()
}

export async function generateEvent(characterId, eventTypeKey, customPrompt) {
  const res = await fetch(`${BASE}/events/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ characterId, eventTypeKey, customPrompt }),
  })
  return res.json()
}

/**
 * 连接统一 SSE 推送流（替代 3 个独立 SSE 长连接）
 *
 * 合并以下三条流为一个 HTTP 连接，释放 HTTP/1.1 6 连接限制下的 2 个连接位：
 *   - /api/events/stream    → handlers['new_event'|'event_update'|...]
 *   - /api/moments/stream    → handlers['new_post']
 *   - /api/notifications/stream → handlers['proactive_message']
 *
 * @param {{ [eventType: string]: Function }} handlers - key = SSE event type, value = callback(data)
 * @returns {{ close: () => void, _closed: boolean }}
 */
export function connectUnifiedStream(handlers = {}, { onClose } = {}) {
  const controller = new AbortController()
  const conn = { _closed: false }

  conn.close = () => {
    conn._closed = true
    controller.abort()
  }

  function _handleClose() {
    if (conn._closed) return  // 已经关闭过（可能是主动 close）
    conn._closed = true
    if (onClose) onClose()
  }

  fetch(`${BASE}/stream`, { signal: controller.signal })
    .then(async (res) => {
      if (!res.ok) {
        console.warn('[api] unified SSE connection failed:', res.status)
        _handleClose()
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let eventType = ''

      while (true) {
        let done, value
        try { ({ done, value } = await reader.read()) } catch { break }
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim()
          } else if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              const fn = handlers[eventType]
              if (fn) fn(data)
            } catch { /* ignore parse errors */ }
          }
        }
      }
      _handleClose()
    })
    .catch(err => {
      if (err.name !== 'AbortError') {
        console.warn('[api] unified SSE error:', err.message)
      }
      _handleClose()
    })

  return conn
}

/** @deprecated 使用 connectUnifiedStream 替代 */
export function connectEventsStream(handlers = {}) {
  const controller = new AbortController()
  const conn = { _closed: false }

  conn.close = () => {
    conn._closed = true
    controller.abort()
  }

  fetch(`${BASE}/events/stream`, { signal: controller.signal })
    .then(async (res) => {
      if (!res.ok) {
        console.warn('[api] events SSE connection failed:', res.status)
        conn._closed = true
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let eventType = ''

      while (true) {
        let done, value
        try { ({ done, value } = await reader.read()) } catch { break }
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (line.startsWith('event: ')) {
            eventType = line.slice(7).trim()
          } else if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              if (eventType === 'new_event') handlers.onNewEvent?.(data)
              else if (eventType === 'event_update') handlers.onUpdate?.(data)
              else if (eventType === 'event_concluded') handlers.onConclusion?.(data)
              else if (eventType === 'event_expired') handlers.onExpired?.(data)
            } catch { /* ignore parse errors */ }
          }
        }
      }
      conn._closed = true
    })
    .catch(err => {
      conn._closed = true
      if (err.name !== 'AbortError') {
        console.warn('[api] events SSE error:', err.message)
      }
    })

  return conn
}
