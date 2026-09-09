const BASE = '/api'

// 统一请求基元：非 2xx 自动抛出服务端 error 信息，成功返回解析后的 JSON
async function request(path, { method = 'GET', body, headers, signal } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json', ...headers } : headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  })
  const result = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(result.error || result.message || `请求失败 (${res.status})`)
  return result
}

// 统一 SSE 解析循环：按行解析 event:/data: 帧，每帧回调 onEvent(event, data)。
// data 帧回调 JSON 解析后的对象；仅 event 行时 data 为 undefined。
// 读取错误向上抛（由调用方决定静默断开还是向下游报错），流自然结束则正常返回。
async function consumeSSE(res, onEvent) {
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let eventType = null
  while (true) {
    const { done, value } = await reader.read()
    if (done) return
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        eventType = line.slice(7).trim()
        onEvent(eventType, undefined)
      } else if (line.startsWith('data: ')) {
        try {
          onEvent(eventType, JSON.parse(line.slice(6)))
        } catch { /* ignore parse errors */ }
      }
    }
  }
}

// ── Characters ──
export async function listCharacters() {
  return request(`/characters`)
}

export async function getMessages(characterId) {
  return request(`/characters/${characterId}/messages`)
}

export async function updateCharacter(id, data) {
  return request(`/characters/${id}`, { method: 'PUT', body: data })
}

// ── 角色专属外观/形态 ──
export function listCharacterOutfits(characterId) {
  return request(`/characters/${characterId}/outfits`)
}

export function createCharacterOutfit(characterId, data) {
  return request(`/characters/${characterId}/outfits`, { method: 'POST', body: data })
}

export function updateCharacterOutfit(characterId, outfitId, data) {
  return request(`/characters/${characterId}/outfits/${outfitId}`, { method: 'PUT', body: data })
}

export function deleteCharacterOutfit(characterId, outfitId) {
  return request(`/characters/${characterId}/outfits/${outfitId}`, { method: 'DELETE' })
}

export async function clearMessages(characterId) {
  return request(`/characters/${characterId}/messages`, { method: 'DELETE' })
}

export async function undoLastRound(characterId) {
  return request(`/characters/${characterId}/messages/last-round`, { method: 'DELETE' })
}

export async function generateCharacter(description) {
  return request(`/characters/generate`, { method: 'POST', body: { description } })
}

/** 预览模式生成角色：只生成不入库，由前端确认后再调 createCharacter */
export async function generateCharacterPreview(description, { searchContext = '' } = {}) {
  return request(`/characters/generate`, { method: 'POST', body: { description, save: false, searchContext } })
}

/** 导入酒馆角色卡（PNG 内嵌 chara / JSON 卡），返回预览数据，直接进入招募预览步骤 */
export async function importCharacterCard({ data, mimetype, filename }) {
  return request(`/characters/import-card`, { method: 'POST', body: { data, mimetype, filename } })
}
/** 直接创建角色（确认入库） */
export async function createCharacter(data) {
  return request(`/characters`, { method: 'POST', body: data })
}

// ── 表情包管理 ──
export function getEmojiOverview() {
  return request(`/characters/emoji/overview`)
}

// ── 表情包配置单（多套切换） ──
export function createEmojiSet(characterId, name = '') {
  return request(`/characters/emoji/sets`, { method: 'POST', body: { character_id: characterId, name } })
}

export function activateEmojiSet(setId) {
  return request(`/characters/emoji/sets/${setId}/activate`, { method: 'POST' })
}

export function renameEmojiSet(setId, name) {
  return request(`/characters/emoji/sets/${setId}`, { method: 'PUT', body: { name } })
}

export function deleteEmojiSet(setId) {
  return request(`/characters/emoji/sets/${setId}`, { method: 'DELETE' })
}

export function getEmojiCategories() {
  return request(`/characters/emoji/categories`)
}

export function updateEmojiCategories(keys) {
  return request(`/characters/emoji/categories`, { method: 'PUT', body: { keys } })
}

export function getEmojiFixedTags() {
  return request(`/characters/emoji/tags`)
}

export function updateEmojiFixedTags(tags, styleMode, resolution) {
  return request(`/characters/emoji/tags`, {
    method: 'PUT',
    body: { tags, styleMode, ...(resolution ? { resolution } : {}) },
  })
}

export function generateEmojiPrompts(character_ids, style = '', setId = null) {
  return request(`/characters/emoji/prompts`, { method: 'POST', body: { character_ids, style, set_id: setId } })
}

export function generateEmojiImages(character_ids, keys = [], artist = '@ebora', includeDone = false, setId = null) {
  return request(`/characters/emoji/images`, {
    method: 'POST',
    body: { character_ids, keys, artist, includeDone: !!includeDone, set_id: setId },
  })
}

export function regenerateEmojiPrompt(characterId, key, style = '', setId = null) {
  return request(`/characters/emoji/${characterId}/${key}/prompt`, { method: 'POST', body: { style, set_id: setId } })
}

export function regenerateEmojiImage(characterId, key, artist = '@ebora', setId = null) {
  return request(`/characters/emoji/${characterId}/${key}/image`, { method: 'POST', body: { artist, set_id: setId } })
}

export function uploadEmojiImage(characterId, key, base64, setId = null) {
  return request(`/characters/emoji/${characterId}/${encodeURIComponent(key)}/upload`, {
    method: 'POST',
    body: { base64, set_id: setId },
  })
}

export function deleteEmoji(characterId, key, setId = null) {
  const query = setId ? `?set_id=${setId}` : ''
  return request(`/characters/emoji/${characterId}/${key}${query}`, { method: 'DELETE' })
}

export async function deleteCharacter(id) {
  return request(`/characters/${id}`, { method: 'DELETE' })
}

export async function uploadAvatar(characterId, base64) {
  return request(`/characters/${characterId}/avatar`, { method: 'POST', body: { base64 } })
}

export async function getRecentImages(characterId) {
  return request(`/characters/${characterId}/recent-images`)
}

/** AI 生成角色头像（脸部特写，表情跟随人格） */
export function generateAvatar(characterId) {
  return request(`/characters/${characterId}/generate-avatar`, { method: 'POST' })
}

/** 上传/清除角色聊天背景（base64，空串 = 恢复默认） */
export async function uploadChatBg(characterId, base64) {
  return request(`/characters/${characterId}/chat-bg`, { method: 'POST', body: { base64 } })
}

/** AI 生成角色聊天背景（依据角色设定与可选场景提示，横版无人物） */
export function generateChatBg(characterId, prompt = '') {
  return request(`/characters/${characterId}/generate-chat-bg`, { method: 'POST', body: { prompt } })
}

/** 生成角色立绘（requirement 为额外立绘需求，可空） */
export function generateStanding(characterId, requirement = '') {
  return request(`/characters/${characterId}/generate-standing`, { method: 'POST', body: { requirement } })
}

/** 删除角色立绘 */
export function deleteStanding(characterId) {
  return request(`/characters/${characterId}/standing`, { method: 'DELETE' })
}

/** 上传本地图片作为角色立绘（base64 data URL，替换旧立绘） */
export function uploadStanding(characterId, base64) {
  return request(`/characters/${characterId}/standing-upload`, { method: 'POST', body: { base64 } })
}

/** 用已有英文 prompt 直接重出立绘（不重新请求提示词） */
export function regenerateStandingImage(characterId, prompt) {
  return request(`/characters/${characterId}/generate-standing-image`, { method: 'POST', body: { prompt } })
}

/** 当前立绘姿势风格（normal / dynamic，全局设置） */
export function getStandingMode() {
  return request(`/characters/standing-mode`)
}

/** 切换立绘姿势风格（system_settings 持久化） */
export function updateStandingMode(mode) {
  return request(`/characters/standing-mode`, { method: 'PUT', body: { mode } })
}

// ── Workflows ──
export async function getWorkflows() {
  return request(`/workflows`)
}

// ── Character Relationships ──
export async function getRelationships(characterId) {
  return request(`/relationships?character_id=${characterId}`)
}

export async function createRelationship(from_character_id, to_character_id, relationship_text) {
  return request(`/relationships`, { method: 'POST', body: { from_character_id, to_character_id, relationship_text } })
}

export async function updateRelationship(id, relationship_text) {
  return request(`/relationships/${id}`, { method: 'PUT', body: { relationship_text } })
}

export async function deleteRelationship(id) {
  return request(`/relationships/${id}`, { method: 'DELETE' })
}

export async function deduceRelationships(characterId, boost, excludeNames) {
  return request(`/relationships/deduce`, { method: 'POST', body: { characterId, boost, excludeNames } })
}

export async function deduceUserRelationships(boost, excludeNames) {
  return request(`/relationships/deduce`, { method: 'POST', body: { mode: 'user', boost, excludeNames } })
}

// ── User Relationships ──
export async function getUserRelationships() {
  return request(`/user-relationships`)
}

export async function createUserRelationship(character_id, relationship_text) {
  return request(`/user-relationships`, { method: 'POST', body: { character_id, relationship_text } })
}

export async function updateUserRelationship(id, relationship_text) {
  return request(`/user-relationships/${id}`, { method: 'PUT', body: { relationship_text } })
}

export async function deleteUserRelationship(id) {
  return request(`/user-relationships/${id}`, { method: 'DELETE' })
}

export function chatStream(characterId, message, clientMsgId, imageMode = 'smart', deepThink = false) {
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
            body: JSON.stringify({ message, client_msg_id: clientMsgId, image_mode: imageMode, force_image_gen: imageMode === 'force', deep_think: !!deepThink }),
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
        await consumeSSE(res, (event, data) => {
          if (data === undefined) {
            outerController.enqueue({ type: 'event', event })
          } else {
            outerController.enqueue({ type: 'data', event, data })
          }
        })
        outerController.close()
      } catch (err) {
        if (err.name !== 'AbortError') outerController.error(err)
      }
    },
  })
  return { stream, abort: () => controller.abort() }
}

// ── Groups（群聊）──
export async function listGroups() {
  return request(`/groups`)
}

export function createGroup({ name, topic, member_ids }) {
  return request(`/groups`, { method: 'POST', body: { name, topic, member_ids } })
}

export async function updateGroup(id, data) {
  return request(`/groups/${id}`, { method: 'PATCH', body: data })
}

export async function deleteGroup(id) {
  return request(`/groups/${id}`, { method: 'DELETE' })
}

export function undoLastGroupRound(id) {
  return request(`/groups/${id}/messages/last-round`, { method: 'DELETE' })
}

export async function getGroupMessages(id) {
  return request(`/groups/${id}/messages`)
}

export async function markGroupSeen(id) {
  return request(`/groups/${id}/seen`, { method: 'POST' })
}

/** 冷场续聊：用户停留但没人说话时触发角色继续聊（消息经统一 SSE 到达） */
export async function nudgeGroup(id) {
  return request(`/groups/${id}/nudge`, { method: 'POST' })
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
        await consumeSSE(res, (event, data) => {
          if (data !== undefined) {
            outerController.enqueue({ type: 'data', event, data })
          }
        })
        outerController.close()
      } catch (err) {
        if (err.name !== 'AbortError') outerController.error(err)
      }
    },
  })
  return { stream, abort: () => controller.abort() }
}

// ── Config ──
export async function getConfig() {
  return request(`/config`)
}

export async function updateComfyConfig(data) {
  await request(`/config/comfy`, { method: 'PUT', body: data })
}

export async function fetchLorasFiles() {
  return request(`/config/loras-files`)
}

export async function updateGlobalLora(loras) {
  await request(`/config/global-lora`, { method: 'PUT', body: { loras } })
}

/** 更新 HiresFix 细化专用 LoRA（仅作用于放大细化工作流） */
/** 更新 HiresFix 细化完整设置（LoRA + 步数/重绘幅度/CFG） */
export function updateHiresSettings({ loras, steps, cfg, denoise, maxSize, artistMode, artist }) {
  return request(`/config/hires`, { method: 'PUT', body: { loras, steps, cfg, denoise, maxSize, artistMode, artist } })
}

export async function updateFeatureFlag(key, value) {
  await request(`/config/features`, { method: 'PUT', body: { key, value } })
}

/** 更新主动聊天频率 0~1 */
export async function updateProactiveFreq(value) {
  await request(`/config/proactive-freq`, { method: 'PUT', body: { value } })
}

/** 更新群聊 LLM 温度 0.5~1.2（所有群共享） */
export function updateGroupTemperature(value) {
  return request(`/config/group-temperature`, { method: 'PUT', body: { value } })
}

/** 更新群聊记忆总结/滑动窗口推进轮次 2~6（所有群共享） */
export function updateGroupSummaryInterval(value) {
  return request(`/config/group-summary-interval`, { method: 'PUT', body: { value } })
}

/** 更新奇遇触发频率 0~1 */
export async function updateEventFreq(value) {
  await request(`/config/event-freq`, { method: 'PUT', body: { value } })
}

/** 更新后台 LLM 并发数 1~10 */
export async function updateBackgroundConcurrency(value) {
  await request(`/config/background-llm-concurrency`, { method: 'PUT', body: { value } })
}

/** 更新防打扰模式总开关 */
export async function updateDisturbMode(value) {
  return request(`/config/disturb-mode`, { method: 'PUT', body: { value } })
}

/** 更新防打扰时间段和角色列表 */
export async function updateDisturbSettings(data) {
  return request(`/config/disturb-settings`, { method: 'PUT', body: data })
}

/** 设置天气城市 */
export async function updateWeatherCity(city) {
  return request(`/config/weather-city`, { method: 'PUT', body: { city } })
}

export async function updateLlmConfig(data) {
  return request(`/config/llm`, { method: 'PUT', body: data })
}

export function testLlmConnection(data) {
  return request(`/config/llm/test`, { method: 'POST', body: data })
}

/** 每日免费鸡蛋开关（opencode zen 免费端点，免 Key） */
export function setLlmFreeEgg(enabled) {
  return request(`/config/llm/free-egg`, { method: 'PUT', body: { enabled } })
}

export function fetchLlmApiKey() {
  return request(`/config/llm/key`)
}

export function fetchLlmModels(data) {
  return request(`/config/llm/models`, { method: 'POST', body: data })
}

// ── LLM Profile 管理 ──

export async function getLlmProfiles() {
  return request(`/config/llm/profiles`)
}

export async function addLlmProfile(name, config = {}) {
  return request(`/config/llm/profiles`, { method: 'POST', body: { name, ...config } })
}

export async function deleteLlmProfile(id) {
  return request(`/config/llm/profiles/${id}`, { method: 'DELETE' })
}

export async function activateLlmProfile(id) {
  return request(`/config/llm/profiles/${id}/activate`, { method: 'POST' })
}

export async function syncActiveLlmProfile() {
  await request(`/config/llm/profiles/active/sync`, { method: 'PUT' })
}

// ── Chat Memory ──
export function getMemoryConfig() {
  return request(`/config/memory`)
}

export function updateMemoryConfig(data) {
  return request(`/config/memory`, { method: 'PUT', body: data })
}

export function testMemoryEmbedding(data) {
  return request(`/config/memory/test-embedding`, { method: 'POST', body: data })
}

export function testMemoryReranker(data) {
  return request(`/config/memory/test-reranker`, { method: 'POST', body: data })
}

export function getMemoryStats() {
  return request(`/memory/stats`)
}

// 阶段四：archived 记忆恢复
export function restoreMemoryFragment(id) {
  return request(`/memory/fragments/${encodeURIComponent(id)}/restore`, { method: 'POST' })
}

// 阶段三：整理 daemon 任务队列与手动触发
export function getConsolidationJobs(limit = 30) {
  return request(`/memory/consolidation/jobs?limit=${encodeURIComponent(limit)}`)
}

export function runConsolidationNow() {
  return request(`/memory/consolidation/run`, { method: 'POST' })
}

export function getMemoryFragments(params = {}) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') query.set(key, value)
  }
  return request(`/memory/fragments?${query}`)
}

export function searchMemories(queryText, options = {}) {
  const query = new URLSearchParams({ q: queryText })
  if (options.conversationId) query.set('conversation_id', options.conversationId)
  if (options.topK) query.set('top_k', options.topK)
  return request(`/memory/search?${query}`)
}

export function deleteMemoryFragment(id) {
  return request(`/memory/fragments/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function getMemoryIndexJobs(limit = 30) {
  return request(`/memory/index-jobs?limit=${encodeURIComponent(limit)}`)
}

export function reindexMemories() {
  return request(`/memory/reindex`, { method: 'POST' })
}

export function retryFailedMemories() {
  return request(`/memory/retry-failed`, { method: 'POST' })
}

// ── World Settings ──
export async function getWorldSettings() {
  return request(`/config/world-settings`)
}

export async function createWorldSetting(data) {
  return request(`/config/world-settings`, { method: 'POST', body: data })
}

export async function updateWorldSetting(id, data) {
  return request(`/config/world-settings/${id}`, { method: 'PUT', body: data })
}

export async function deleteWorldSetting(id) {
  return request(`/config/world-settings/${id}`, { method: 'DELETE' })
}

export async function getSystemRules() {
  return request(`/config/system-rules`)
}

export async function polishWorldSetting(data) {
  return request(`/config/world-settings/polish`, { method: 'POST', body: data })
}

export async function activateWorldSetting(id) {
  return request(`/config/world-settings/${id}/activate`, { method: 'POST' })
}

// ── Global Rules ──
export async function getGlobalRules() {
  return request(`/config/rules`)
}

export async function updateGlobalRule(key, data) {
  return request(`/config/rules/${encodeURIComponent(key)}`, { method: 'PUT', body: data })
}

/** 获取单条规则的默认值（不修改，仅供预览） */
export async function getDefaultRule(key) {
  return request(`/config/rules/${encodeURIComponent(key)}/default`)
}

/** 重置单条全局规则为默认值 */
export async function resetGlobalRule(key) {
  return request(`/config/rules/${encodeURIComponent(key)}/reset`, { method: 'POST' })
}

// ── User Avatar ──
export async function getUserAvatar() {
  return request(`/config/user-avatar`)
}

export async function uploadUserAvatar(base64) {
  return request(`/config/user-avatar`, { method: 'POST', body: { base64 } })
}

// ── User config (nickname + persona) ──
export async function getUserConfig() {
  return request(`/config/user`)
}

export async function updateUserConfig(data) {
  return request(`/config/user`, { method: 'PUT', body: data })
}

// ── 测试画风（固定提示词，不存 DB；mode: 'chat' | 'moments'；prompt 可选覆盖默认；
// sceneDesc 可选自由画面描述 → LLM 完善；reuseSceneLoras 复用上次自由画面测试匹配到的角色 lora）──
export async function testStyle({ artist, width, height, mode = 'chat', prompt = '', sceneDesc = '', reuseSceneLoras = false, alreadyPrepared = false } = {}) {
  const body = { artist, width, height, mode };
  if (prompt) body.prompt = prompt;
  if (sceneDesc) body.sceneDesc = sceneDesc;
  if (reuseSceneLoras) body.reuseSceneLoras = true;
  if (alreadyPrepared) body.alreadyPrepared = true;
  return request(`/images/test-style`, { method: 'POST', body: body })
}

/** 测试细化（最近一张图，HiresFix 参数流程，不落盘，返回原图+细化图） */
export function testHires() {
  return request(`/images/test-hires`, { method: 'POST' });
}

// ── Moments 朋友圈 ──
export async function listMoments() {
  return request(`/moments`)
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
      try {
        await consumeSSE(res, (event, data) => {
          if (data !== undefined && event === 'new_post') onNewPost(data)
        })
      } catch { /* 连接中断，交给上层重连逻辑 */ }
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
      try {
        await consumeSSE(res, (event, data) => {
          if (data !== undefined && event === 'proactive_message') onProactiveMessage(data)
        })
      } catch { /* 连接中断，交给上层重连逻辑 */ }
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
  return request(`/notifications/unread`)
}

/** 标记某角色的主动消息已读 */
export async function markProactiveRead(characterId) {
  await request(`/notifications/mark-read/${characterId}`, { method: 'POST' })
}

/** 调试：强制随机角色发起一次主动聊天 */
export async function forceProactive() {
  return request(`/notifications/force-proactive`, { method: 'POST' })
}

export async function getMoment(id) {
  return request(`/moments/${id}`)
}

/** 获取朋友圈未读计数 */
export async function getMomentsUnread() {
  return request(`/moments/unread-count`)
}

/** 清零朋友圈未读计数 */
export async function markMomentsRead() {
  return request(`/moments/mark-read`, { method: 'POST' })
}

export async function generateMoment(characterId) {
  return request(`/moments/generate`, { method: 'POST', body: { character_id: characterId } })
}

export async function deleteMoment(id) {
  return request(`/moments/${id}`, { method: 'DELETE' })
}

export async function commentMoment(postId, content) {
  return request(`/moments/${postId}/comments`, { method: 'POST', body: { content } })
}

export async function deleteMomentComment(postId, commentId) {
  return request(`/moments/${postId}/comments/${commentId}`, { method: 'DELETE' })
}

export async function likeMoment(postId) {
  return request(`/moments/${postId}/like`, { method: 'POST' })
}

// ── 角色对用户的画像（user_portraits）──
export async function getCharacterPortrait(characterId) {
  return request(`/portraits/${characterId}`)
}

export function addPortrait(characterId, traitType, content) {
  return request(`/portraits`, { method: 'POST', body: { characterId, traitType, content } })
}

export function updatePortrait(id, content) {
  return request(`/portraits/${id}`, { method: 'PUT', body: { content } })
}

export function deletePortrait(id) {
  return request(`/portraits/${id}`, { method: 'DELETE' })
}

// ── 阶段三 T4：画像升华建议（daemon 产出，人工确认）──
export async function getPortraitSuggestions(characterId) {
  return request(`/portraits/${characterId}/suggestions`)
}

export function confirmPortraitSuggestion(id) {
  return request(`/portraits/suggestions/${id}/confirm`, { method: 'POST' })
}

export function rejectPortraitSuggestion(id) {
  return request(`/portraits/suggestions/${id}/reject`, { method: 'POST' })
}

// ── ComfyUI health ──
export async function comfyuiHealth() {
  try {
    return await request(`/images/comfyui-health`)
  } catch { return { connected: false } }
}

// ── Gift 送礼 ──
export async function sendGift(characterId, giftType, giftLine = '') {
  return request(`/characters/${characterId}/gift`, { method: 'POST', body: { giftType, giftLine } })
}

export async function getGiftCooldowns() {
  return request(`/characters/gift/cooldowns`)
}

export async function resetGiftCooldowns() {
  return request(`/characters/gift/cooldowns`, { method: 'DELETE' })
}

// ── 誓约系统 ──

export async function getOathStatus(characterId) {
  return request(`/characters/${characterId}/oath`)
}

export async function removeOath(characterId) {
  return request(`/characters/${characterId}/oath`, { method: 'DELETE' })
}

// ── Gallery 相册 ──
export function listGalleryImages(limit = 100, offset = 0, folder = '') {
  let path = `/images/gallery?limit=${limit}&offset=${offset}`
  if (folder) path += `&folder=${encodeURIComponent(folder)}`
  return request(path)
}

/** 提交后台重新生成任务（完成后需确认才覆盖原图） */
export function regenerateImage(imageUrl) {
  return request(`/images/regenerate`, { method: 'POST', body: { url: imageUrl } })
}

/** 提交后台 HiresFix 细化任务（完成后需确认才覆盖原图） */
export function upscaleImage(imageUrl) {
  return request(`/images/upscale`, { method: 'POST', body: { url: imageUrl } })
}

/** 运行中 / 待确认 / 失败的图片编辑任务 */
export function listImageEditTasks() {
  return request(`/images/edit-tasks`)
}

/** 确认覆盖：用暂存结果原子替换原图 */
export function applyImageEditTask(taskId, token) {
  return request(`/images/edit-tasks/${taskId}/apply`, { method: 'POST', body: { token } })
}

/** 重新生成：按原动作 + 原图再跑一次 */
export function rerunImageEditTask(taskId, token) {
  return request(`/images/edit-tasks/${taskId}/rerun`, { method: 'POST', body: { token } })
}

/** 保留原图：删除暂存结果 */
export function discardImageEditTask(taskId, token) {
  return request(`/images/edit-tasks/${taskId}/discard`, { method: 'POST', body: { token } })
}
/** 删除指定图片（物理文件） */
export function deleteImage(imageUrl) {
  return request(`/images/delete`, { method: 'DELETE', body: { url: imageUrl } })
}

// ── 图片压缩 ──
export async function getCompressStatus() {
  return request(`/images/compress/status`)
}

export async function updateCompressConfig(data) {
  return request(`/images/compress/config`, { method: 'PUT', body: data })
}

export async function startCompress() {
  return request(`/images/compress/start`, { method: 'POST' })
}

export async function cancelCompress() {
  return request(`/images/compress/cancel`, { method: 'POST' })
}

// ── 画师串收藏夹 ──
export async function getArtistFavorites() {
  return request(`/config/artist-favorites`)
}

export async function addArtistFavorite({ label, artist }) {
  return request(`/config/artist-favorites`, { method: 'POST', body: { label, artist } })
}

export async function updateArtistFavorite(id, data) {
  return request(`/config/artist-favorites/${id}`, { method: 'PUT', body: data })
}

export async function deleteArtistFavorite(id) {
  return request(`/config/artist-favorites/${id}`, { method: 'DELETE' })
}

// ── Events 奇遇 ──
export async function listEvents() {
  return request(`/events`)
}

export async function getActiveEvent(characterId) {
  return request(`/events/active/${characterId}`)
}

/** 按 id 取历史事件详情；未找到（非 2xx）返回 null 而不抛错 */
export async function getEventById(eventId) {
  try {
    return await request(`/events/by-id/${eventId}`)
  } catch { return null }
}

export async function chooseEventOption(eventId, choice, customText) {
  // 120s 超时：LLM (~15s) + ComfyUI 生图 (~90s) 的总耗时上限
  // 避免请求无限挂起耗尽浏览器 HTTP/1.1 连接池（6 连接限制 + 3 SSE = 仅剩 3 可用）
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 120_000)
  try {
    return request(`/events/${eventId}/choose`, { method: 'POST', body: { choice, customText }, signal: controller.signal })
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function undoEventOption(eventId) {
  return request(`/events/${eventId}/undo`, { method: 'POST' })
}

export async function dismissEvent(eventId) {
  return request(`/events/${eventId}/dismiss`, { method: 'POST' })
}

export async function concludeEvent(eventId) {
  return request(`/events/${eventId}/conclude`, { method: 'POST' })
}

export async function deleteEvent(eventId) {
  return request(`/events/${eventId}`, { method: 'DELETE' })
}

export async function getEventsUnread() {
  return request(`/events/unread-count`)
}

export async function markEventsRead() {
  return request(`/events/mark-read`, { method: 'POST' })
}

export async function generateEvent(characterId, eventTypeKey, customPrompt) {
  return request(`/events/generate`, { method: 'POST', body: { characterId, eventTypeKey, customPrompt } })
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
      try {
        await consumeSSE(res, (event, data) => {
          if (data === undefined) return
          const fn = handlers[event]
          if (fn) fn(data)
        })
      } catch { /* 连接中断，交给上层重连逻辑 */ }
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
      try {
        await consumeSSE(res, (event, data) => {
          if (data === undefined) return
          if (event === 'new_event') handlers.onNewEvent?.(data)
          else if (event === 'event_update') handlers.onUpdate?.(data)
          else if (event === 'event_concluded') handlers.onConclusion?.(data)
          else if (event === 'event_expired') handlers.onExpired?.(data)
        })
      } catch { /* 连接中断，交给上层重连逻辑 */ }
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

export function getScheduleOverview() {
  return request(`/schedule`)
}

export function getCharacterSchedule(characterId) {
  return request(`/schedule/${characterId}`)
}

export function getCurrentActivity(characterId) {
  return request(`/schedule/${characterId}/current`)
}

export function peekSnapshot(characterId, genImage = true, activityContext = null) {
  const body = { gen_image: genImage };
  if (activityContext) body.activity = activityContext;
  return request(`/schedule/${characterId}/peek`, { method: 'POST', body })
}

/** 瞄一眼再拍一张：使用已生成的 prompt 重新提交 ComfyUI 生图 */
export function retakePeekSnapshot(characterId, prompt) {
  return request(`/schedule/${characterId}/peek/retake`, { method: 'POST', body: { prompt } })
}

export function regenerateSchedule(characterId, direction) {
  const body = {}
  if (direction) body.direction = direction
  return request(`/schedule/${characterId}/regenerate`, { method: 'POST', body })
}

/** 重置世界线：重新生成所有角色日程（后端 SSE 推送进度） */
export function regenerateAllSchedules(direction) {
  const body = {}
  if (direction) body.direction = direction
  return request(`/schedule/regenerate-all`, { method: 'POST', body })
}

/** 取消正在进行的重置世界线任务 */
export async function cancelRegenerateAll() {
  return request(`/schedule/regenerate-all/cancel`, { method: 'POST' })
}

/** 查询当前重置世界线任务状态（页面刷新恢复用） */
export function getResetStatus() {
  return request(`/schedule/reset-status`)
}

/** 清空指定角色的所有日程（模板、快照、禁用自动生成） */
export function clearSchedule(characterId) {
  return request(`/schedule/${characterId}/clear`, { method: 'POST' })
}

// ── 叫醒系统 ──

/** 电话叫醒（40% 概率成功） */
export function wakeUpByPhone(characterId) {
  return request(`/schedule/${characterId}/wake-up-phone`, { method: 'POST' })
}

/** 上门摇醒（必定成功） */
export function wakeUpByDoor(characterId) {
  return request(`/schedule/${characterId}/wake-up-door`, { method: 'POST' })
}

// ── 工作流管理 ──
export async function checkWorkflowStatus() {
  return request(`/workflows/status`)
}

export async function restoreWorkflow() {
  return request(`/workflows/restore`, { method: 'POST' })
}

export async function updateWorkflowMode(mode) {
  return request(`/config/workflow-mode`, { method: 'PUT', body: { mode } })
}

export async function updateWorkflowScene(scene) {
  return request(`/config/workflow-scene`, { method: 'PUT', body: { scene } })
}

// ── 信箱 ──

export async function listLetters(page = 1, limit = 20) {
  return request(`/mailbox?page=${page}&limit=${limit}`)
}

export async function getUnreadCount() {
  return request(`/mailbox/unread`)
}

export async function sendLetter(characterId, title, content) {
  return request(`/mailbox/send`, { method: 'POST', body: { character_id: characterId, title, content } })
}

export async function getLetter(id) {
  return request(`/mailbox/${id}`)
}

export async function markLetterRead(id) {
  return request(`/mailbox/${id}/mark-read`, { method: 'PUT' })
}

export async function deleteLetter(id) {
  return request(`/mailbox/${id}`, { method: 'DELETE' })
}

// ── 事件库管理（奇遇事件类型 / 朋友圈话题）──

export async function listEventTypes() {
  return request(`/library/event-types`)
}

export function createEventType(data) {
  return request(`/library/event-types`, { method: 'POST', body: data })
}

export function updateEventType(id, data) {
  return request(`/library/event-types/${id}`, { method: 'PUT', body: data })
}

export function deleteEventType(id) {
  return request(`/library/event-types/${id}`, { method: 'DELETE' })
}

export function generateEventTypes(direction) {
  return request(`/library/event-types/generate`, { method: 'POST', body: { direction } })
}

export function saveEventTypeBatch(items) {
  return request(`/library/event-types/save-batch`, { method: 'POST', body: { items } })
}

export async function listTopics() {
  return request(`/library/topics`)
}

export function createTopic(data) {
  return request(`/library/topics`, { method: 'POST', body: data })
}

export function updateTopic(id, data) {
  return request(`/library/topics/${id}`, { method: 'PUT', body: data })
}

export function deleteTopic(id) {
  return request(`/library/topics/${id}`, { method: 'DELETE' })
}

export function generateTopics(direction) {
  return request(`/library/topics/generate`, { method: 'POST', body: { direction } })
}

export function saveTopicBatch(items) {
  return request(`/library/topics/save-batch`, { method: 'POST', body: { items } })
}

// ── MaiBot 桥接（供系统设置内「MaiBot 桥接」页面调用）──
async function maibotFetch(path, options = {}) {
  const headers = {}
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${BASE}/maibot${path}`, {
    ...options,
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  })
  let data = null
  try { data = await res.json() } catch { /* 非 JSON 响应按 null 处理 */ }
  if (!res.ok) throw new Error((data && data.error) || (`HTTP ${res.status}`))
  return data
}

export function maibotGetWebuiSettings() {
  return maibotFetch('/webui-settings')
}
export function maibotSaveWebuiSettings(token) {
  return maibotFetch('/webui-settings', { method: 'POST', body: { token } })
}
export function maibotListCharacters() {
  return maibotFetch('/characters')
}
export function maibotGetPluginConfig() {
  return maibotFetch('/plugin-config')
}
export function maibotUpdatePluginConfig(config) {
  return maibotFetch('/plugin-config', { method: 'PUT', body: { config } })
}
export function maibotGetPluginPersona() {
  return maibotFetch('/plugin-persona')
}
export function maibotUpdatePluginPersona(payload) {
  return maibotFetch('/plugin-persona', { method: 'PUT', body: payload })
}
export function maibotDeriveStyle(basePrompt) {
  return maibotFetch('/derive-style', { method: 'POST', body: { base_prompt: basePrompt } })
}
export function maibotGetLatestMemory() {
  return maibotFetch('/latest-memory')
}
export function maibotDeleteLatestMemory(sessionId) {
  return maibotFetch(`/latest-memory?session_id=${encodeURIComponent(sessionId)}`, { method: 'DELETE' })
}

// ── 背包 / 道具系统 ──

// 背包内容（已收下）+ 待收下道具 + 宝箱冷却状态 + 生效中的效果
export function listItems() {
  return request(`/items`)
}

// 开启每日宝箱（16 小时冷却；道具图片异步生成，完成后经 item_ready 事件刷新）
export function openChest() {
  return request(`/items/chest/open`, { method: 'POST' })
}

// 收下道具（开箱后需收下才出现在背包）
export function collectItem(itemId) {
  return request(`/items/${itemId}/collect`, { method: 'POST' })
}

// 使用道具
export function useItem(itemId, characterId) {
  return request(`/items/${itemId}/use`, { method: 'POST', body: { character_id: characterId } })
}

// 丢弃道具
export function discardItem(itemId) {
  return request(`/items/${itemId}`, { method: 'DELETE' })
}

// 提前移除已生效的效果（服饰/变身会同步撤销临时外观）
export function removeActiveEffect(effectId) {
  return request(`/items/effects/${effectId}`, { method: 'DELETE' })
}
