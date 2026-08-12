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

/** 导入酒馆角色卡（PNG 内嵌 chara / JSON 卡），返回预览数据，直接进入招募预览步骤 */
export async function importCharacterCard({ data, mimetype, filename }) {
  const res = await fetch(`${BASE}/characters/import-card`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data, mimetype, filename }),
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

// ── Workflows ──
export async function getWorkflows() {
  const res = await fetch(`${BASE}/workflows`)
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

export async function deduceRelationships(characterId, boost, excludeNames) {
  const res = await fetch(`${BASE}/relationships/deduce`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ characterId, boost, excludeNames }),
  })
  return res.json()
}

export async function deduceUserRelationships(boost, excludeNames) {
  const res = await fetch(`${BASE}/relationships/deduce`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'user', boost, excludeNames }),
  })
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

      // ── 日程系统：检测 queued 响应（非 SSE，是 JSON）──
      const contentType = res.headers.get('Content-Type') || ''
      if (contentType.includes('application/json')) {
        const json = await res.json()
        if (json.queued) {
          // 返回结构化事件（与正常 SSE 解析路径格式一致，确保 store 能正确识别）
          outerController.enqueue({ type: 'event', event: 'queued' })
          outerController.enqueue({ type: 'data', event: 'queued', data: json })
          outerController.close()
          return
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

// ── Groups（群聊）──
export async function listGroups() {
  const res = await fetch(`${BASE}/groups`)
  return res.json()
}

export async function createGroup({ name, topic, member_ids }) {
  const res = await fetch(`${BASE}/groups`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, topic, member_ids }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `建群失败 (${res.status})`)
  }
  return res.json()
}

export async function updateGroup(id, data) {
  const res = await fetch(`${BASE}/groups/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  return res.json()
}

export async function deleteGroup(id) {
  const res = await fetch(`${BASE}/groups/${id}`, { method: 'DELETE' })
  return res.json()
}

export async function undoLastGroupRound(id) {
  const res = await fetch(`${BASE}/groups/${id}/messages/last-round`, { method: 'DELETE' })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `撤回失败 (${res.status})`)
  }
  return res.json()
}

export async function getGroupMessages(id) {
  const res = await fetch(`${BASE}/groups/${id}/messages`)
  return res.json()
}

export async function markGroupSeen(id) {
  const res = await fetch(`${BASE}/groups/${id}/seen`, { method: 'POST' })
  return res.json()
}

/** 冷场续聊：用户停留但没人说话时触发角色继续聊（消息经统一 SSE 到达） */
export async function nudgeGroup(id) {
  const res = await fetch(`${BASE}/groups/${id}/nudge`, { method: 'POST' })
  return res.json()
}

/** 群聊发言：SSE 流式返回本轮剧本（解析格式与 chatStream 一致）
 * @param {Array<{text, client_msg_id}>} items - 支持一次携带多条聚合消息
 * @param {number|null} truncateAfterMsgId - 打断播放时抛弃该 id 之后未上屏的分句
 */
export function groupChatStream(groupId, items, truncateAfterMsgId = null) {
  const controller = new AbortController()
  const stream = new ReadableStream({
    async start(outerController) {
      let res
      try {
        res = await fetch(`${BASE}/groups/${groupId}/chat`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: items, truncate_after_msg_id: truncateAfterMsgId }),
          signal: controller.signal,
        })
      } catch (err) {
        if (err.name === 'AbortError') { outerController.close(); return }
        outerController.error(err)
        return
      }
      if (!res.ok) {
        outerController.error(new Error(`Server returned ${res.status}`))
        return
      }
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

export async function fetchLorasFiles() {
  const res = await fetch(`${BASE}/config/loras-files`)
  return res.json()
}

export async function updateGlobalLora(loras) {
  await fetch(`${BASE}/config/global-lora`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ loras }),
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

/** 更新群聊 LLM 温度 0.5~1.2（所有群共享） */
export async function updateGroupTemperature(value) {
  const res = await fetch(`${BASE}/config/group-temperature`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || '温度设置保存失败')
  }
  return res.json()
}

/** 更新群聊记忆总结/滑动窗口推进轮次 2~10（所有群共享） */
export async function updateGroupSummaryInterval(value) {
  const res = await fetch(`${BASE}/config/group-summary-interval`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value }),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    throw new Error(data.error || '记忆总结轮次保存失败')
  }
  return res.json()
}

/** 更新奇遇触发频率 0~1 */
export async function updateEventFreq(value) {
  await fetch(`${BASE}/config/event-freq`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ value }),
  })
}

/** 更新后台 LLM 并发数 1~10 */
export async function updateBackgroundConcurrency(value) {
  await fetch(`${BASE}/config/background-llm-concurrency`, {
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

/** 设置天气城市 */
export async function updateWeatherCity(city) {
  const res = await fetch(`${BASE}/config/weather-city`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ city }),
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

export async function fetchLlmApiKey() {
  const res = await fetch(`${BASE}/config/llm/key`)
  const result = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(result.error || '获取 API Key 失败')
  return result
}

export async function fetchLlmModels(data) {
  const res = await fetch(`${BASE}/config/llm/models`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  const result = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(result.error || `获取模型失败 (${res.status})`)
  return result
}

// ── LLM Profile 管理 ──

export async function getLlmProfiles() {
  const res = await fetch(`${BASE}/config/llm/profiles`)
  return res.json()
}

export async function addLlmProfile(name) {
  const res = await fetch(`${BASE}/config/llm/profiles`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  return res.json()
}

export async function deleteLlmProfile(id) {
  const res = await fetch(`${BASE}/config/llm/profiles/${id}`, { method: 'DELETE' })
  return res.json()
}

export async function activateLlmProfile(id) {
  const res = await fetch(`${BASE}/config/llm/profiles/${id}/activate`, { method: 'POST' })
  return res.json()
}

export async function syncActiveLlmProfile() {
  await fetch(`${BASE}/config/llm/profiles/active/sync`, { method: 'PUT' })
}

// ── Chat Memory ──
async function jsonRequest(url, options) {
  const res = await fetch(url, options)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data
}

export function getMemoryConfig() {
  return jsonRequest(`${BASE}/config/memory`)
}

export function updateMemoryConfig(data) {
  return jsonRequest(`${BASE}/config/memory`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  })
}

export function testMemoryEmbedding(data) {
  return jsonRequest(`${BASE}/config/memory/test-embedding`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  })
}

export function testMemoryReranker(data) {
  return jsonRequest(`${BASE}/config/memory/test-reranker`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  })
}

export function getMemoryStats() {
  return jsonRequest(`${BASE}/memory/stats`)
}

export function getMemoryFragments(params = {}) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') query.set(key, value)
  }
  return jsonRequest(`${BASE}/memory/fragments?${query}`)
}

export function searchMemories(queryText, options = {}) {
  const query = new URLSearchParams({ q: queryText })
  if (options.conversationId) query.set('conversation_id', options.conversationId)
  if (options.topK) query.set('top_k', options.topK)
  return jsonRequest(`${BASE}/memory/search?${query}`)
}

export function deleteMemoryFragment(id) {
  return jsonRequest(`${BASE}/memory/fragments/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function getMemoryIndexJobs(limit = 30) {
  return jsonRequest(`${BASE}/memory/index-jobs?limit=${encodeURIComponent(limit)}`)
}

export function reindexMemories() {
  return jsonRequest(`${BASE}/memory/reindex`, { method: 'POST' })
}

export function retryFailedMemories() {
  return jsonRequest(`${BASE}/memory/retry-failed`, { method: 'POST' })
}

// ── World Settings ──
export async function getWorldSettings() {
  const res = await fetch(`${BASE}/config/world-settings`)
  return res.json()
}

export async function createWorldSetting(data) {
  const res = await fetch(`${BASE}/config/world-settings`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  })
  return res.json()
}

export async function updateWorldSetting(id, data) {
  const res = await fetch(`${BASE}/config/world-settings/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  })
  return res.json()
}

export async function deleteWorldSetting(id) {
  const res = await fetch(`${BASE}/config/world-settings/${id}`, {
    method: 'DELETE',
  })
  return res.json()
}

export async function getSystemRules() {
  const res = await fetch(`${BASE}/config/system-rules`)
  return res.json()
}

export async function polishWorldSetting(data) {
  const res = await fetch(`${BASE}/config/world-settings/polish`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  })
  return res.json()
}

export async function activateWorldSetting(id) {
  const res = await fetch(`${BASE}/config/world-settings/${id}/activate`, {
    method: 'POST',
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
export async function sendGift(characterId, giftType, giftLine = '') {
  const res = await fetch(`${BASE}/characters/${characterId}/gift`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ giftType, giftLine }),
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

// ── 誓约系统 ──

export async function getOathStatus(characterId) {
  const res = await fetch(`${BASE}/characters/${characterId}/oath`)
  return res.json()
}

export async function removeOath(characterId) {
  const res = await fetch(`${BASE}/characters/${characterId}/oath`, { method: 'DELETE' })
  return res.json()
}

// ── Gallery 相册 ──
export async function listGalleryImages(limit = 100, offset = 0, folder = '') {
  let url = `${BASE}/images/gallery?limit=${limit}&offset=${offset}`
  if (folder) url += `&folder=${encodeURIComponent(folder)}`
  const res = await fetch(url)
  return res.json()
}

/** 重新生成指定图片（用原 prompt 覆盖原文件） */
export async function regenerateImage(imageUrl) {
  const res = await fetch(`${BASE}/images/regenerate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: imageUrl }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `Regenerate failed (${res.status})`)
  }
  return res.json()
}

/** 删除指定图片（物理文件） */
export async function deleteImage(imageUrl) {
  const res = await fetch(`${BASE}/images/delete`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: imageUrl }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `删除失败 (${res.status})`)
  }
  return res.json()
}

// ── 图片压缩 ──
export async function getCompressStatus() {
  const res = await fetch(`${BASE}/images/compress/status`)
  return res.json()
}

export async function updateCompressConfig(data) {
  const res = await fetch(`${BASE}/images/compress/config`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  return res.json()
}

export async function startCompress() {
  const res = await fetch(`${BASE}/images/compress/start`, { method: 'POST' })
  return res.json()
}

export async function cancelCompress() {
  const res = await fetch(`${BASE}/images/compress/cancel`, { method: 'POST' })
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

export async function undoEventOption(eventId) {
  const res = await fetch(`${BASE}/events/${eventId}/undo`, { method: 'POST' })
  return res.json()
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

// ── Schedule 日程系统 ──

export async function getScheduleOverview() {
  const res = await fetch(`${BASE}/schedule`)
  if (!res.ok) throw new Error(`schedule overview: ${res.status}`)
  return res.json()
}

export async function getCharacterSchedule(characterId) {
  const res = await fetch(`${BASE}/schedule/${characterId}`)
  if (!res.ok) throw new Error(`character schedule: ${res.status}`)
  return res.json()
}

export async function getCurrentActivity(characterId) {
  const res = await fetch(`${BASE}/schedule/${characterId}/current`)
  if (!res.ok) throw new Error(`current activity: ${res.status}`)
  return res.json()
}

export async function peekSnapshot(characterId, genImage = true, activityContext = null) {
  const body = { gen_image: genImage };
  if (activityContext) body.activity = activityContext;
  const res = await fetch(`${BASE}/schedule/${characterId}/peek`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`peek snapshot: ${res.status}`)
  return res.json()
}

/** 瞄一眼再拍一张：使用已生成的 prompt 重新提交 ComfyUI 生图 */
export async function retakePeekSnapshot(characterId, prompt) {
  const res = await fetch(`${BASE}/schedule/${characterId}/peek/retake`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  })
  if (!res.ok) throw new Error(`retake peek: ${res.status}`)
  return res.json()
}

export async function regenerateSchedule(characterId, direction) {
  const body = {}
  if (direction) body.direction = direction
  const res = await fetch(`${BASE}/schedule/${characterId}/regenerate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`regenerate schedule: ${res.status}`)
  return res.json()
}

/** 重置世界线：重新生成所有角色日程（后端 SSE 推送进度） */
export async function regenerateAllSchedules(direction) {
  const body = {}
  if (direction) body.direction = direction
  const res = await fetch(`${BASE}/schedule/regenerate-all`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `regenerate all: ${res.status}`)
  }
  return res.json()
}

/** 取消正在进行的重置世界线任务 */
export async function cancelRegenerateAll() {
  const res = await fetch(`${BASE}/schedule/regenerate-all/cancel`, { method: 'POST' })
  return res.json()
}

/** 查询当前重置世界线任务状态（页面刷新恢复用） */
export async function getResetStatus() {
  const res = await fetch(`${BASE}/schedule/reset-status`)
  if (!res.ok) throw new Error(`reset status: ${res.status}`)
  return res.json()
}

/** 清空指定角色的所有日程（模板、快照、禁用自动生成） */
export async function clearSchedule(characterId) {
  const res = await fetch(`${BASE}/schedule/${characterId}/clear`, { method: 'POST' })
  if (!res.ok) throw new Error(`clear schedule: ${res.status}`)
  return res.json()
}

// ── 叫醒系统 ──

/** 电话叫醒（40% 概率成功） */
export async function wakeUpByPhone(characterId) {
  const res = await fetch(`${BASE}/schedule/${characterId}/wake-up-phone`, { method: 'POST' })
  if (!res.ok) throw new Error(`wake up phone: ${res.status}`)
  return res.json()
}

/** 上门摇醒（必定成功） */
export async function wakeUpByDoor(characterId) {
  const res = await fetch(`${BASE}/schedule/${characterId}/wake-up-door`, { method: 'POST' })
  if (!res.ok) throw new Error(`wake up door: ${res.status}`)
  return res.json()
}

// ── 工作流管理 ──
export async function checkWorkflowStatus() {
  const res = await fetch(`${BASE}/workflows/status`)
  return res.json()
}

export async function restoreWorkflow() {
  const res = await fetch(`${BASE}/workflows/restore`, { method: 'POST' })
  return res.json()
}

export async function updateWorkflowMode(mode) {
  const res = await fetch(`${BASE}/config/workflow-mode`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  })
  return res.json()
}

export async function updateWorkflowScene(scene) {
  const res = await fetch(`${BASE}/config/workflow-scene`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scene }),
  })
  return res.json()
}

// ── 信箱 ──

export async function listLetters(page = 1, limit = 20) {
  const res = await fetch(`${BASE}/mailbox?page=${page}&limit=${limit}`)
  return res.json()
}

export async function getUnreadCount() {
  const res = await fetch(`${BASE}/mailbox/unread`)
  return res.json()
}

export async function sendLetter(characterId, title, content) {
  const res = await fetch(`${BASE}/mailbox/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ character_id: characterId, title, content }),
  })
  return res.json()
}

export async function getLetter(id) {
  const res = await fetch(`${BASE}/mailbox/${id}`)
  return res.json()
}

export async function markLetterRead(id) {
  const res = await fetch(`${BASE}/mailbox/${id}/mark-read`, { method: 'PUT' })
  return res.json()
}

export async function deleteLetter(id) {
  const res = await fetch(`${BASE}/mailbox/${id}`, { method: 'DELETE' })
  return res.json()
}

// ── 事件库管理（奇遇事件类型 / 朋友圈话题）──

export async function listEventTypes() {
  const res = await fetch(`${BASE}/library/event-types`)
  return res.json()
}

export function createEventType(data) {
  return jsonRequest(`${BASE}/library/event-types`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  })
}

export function updateEventType(id, data) {
  return jsonRequest(`${BASE}/library/event-types/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  })
}

export function deleteEventType(id) {
  return jsonRequest(`${BASE}/library/event-types/${id}`, { method: 'DELETE' })
}

export function generateEventTypes(direction) {
  return jsonRequest(`${BASE}/library/event-types/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ direction }),
  })
}

export function saveEventTypeBatch(items) {
  return jsonRequest(`${BASE}/library/event-types/save-batch`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }),
  })
}

export async function listTopics() {
  const res = await fetch(`${BASE}/library/topics`)
  return res.json()
}

export function createTopic(data) {
  return jsonRequest(`${BASE}/library/topics`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  })
}

export function updateTopic(id, data) {
  return jsonRequest(`${BASE}/library/topics/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  })
}

export function deleteTopic(id) {
  return jsonRequest(`${BASE}/library/topics/${id}`, { method: 'DELETE' })
}

export function generateTopics(direction) {
  return jsonRequest(`${BASE}/library/topics/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ direction }),
  })
}

export function saveTopicBatch(items) {
  return jsonRequest(`${BASE}/library/topics/save-batch`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }),
  })
}
