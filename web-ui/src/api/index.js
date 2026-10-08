const BASE = '/api'

/**
 * 统一请求基元：非 2xx 自动抛出服务端 error 信息，成功返回解析后的 JSON。
 *
 * ★ 关于「新功能报 404」：本机后端没有热重载，改了 agent-core 的代码后必须重启服务，
 *   否则新路由根本不存在 —— Express 会直接吐一段 HTML（`Cannot POST /api/xxx`），
 *   而不是我们约定的 JSON `{ error }`。这类 404 极容易被误当成功能 bug。
 *   这里统一识别并补一句人话提示，省得每个调用点各写一遍
 *   （已踩三次：日报删除 / 传媒批量操作 / 外观扩写）。
 */
async function request(path, { method = 'GET', body, headers, signal } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json', ...headers } : headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  })
  const raw = await res.text()
  let result = {}
  try { result = raw ? JSON.parse(raw) : {} } catch { /* 非 JSON（多半是 Express 默认 HTML 错误页） */ }
  if (!res.ok) {
    // 404 + 拿不到结构化 error ⇒ 路由没注册（后端是旧代码），而不是"功能坏了"
    const isMissingRoute = res.status === 404 && !result.error && !result.message
    if (isMissingRoute) {
      throw new Error('接口不存在：后端服务还是旧代码，请先在启动器里重启服务再试')
    }
    throw new Error(result.error || result.message || `请求失败 (${res.status})`)
  }
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

// ── 应用自身版本 ──
// 后端读仓库根目录 VERSION 给出的版本号（不带 v）。「本地装的是哪版」只有本机能知道，
// 所以这一步走后端；对比 GitHub 上有没有新 tag 那一步是浏览器直连，不走后端。
export async function getAppVersion() {
  const data = await request('/version')
  return String(data?.version || '')
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

/**
 * 生成一个候选「论坛马甲」（网名 + 网络人设）—— 只返回，不落库。
 * 用户可改可重掷，确认后随 updateCharacter 一起保存。
 * 失败时返回 { alias: '', error }（接口是 200，不是抛错）→ 前端提示可手填。
 */
export async function generateForumAlias(characterId) {
  return request(`/characters/${characterId}/forum-alias`, { method: 'POST', body: {} })
}

// 设置角色置顶状态（幂等写入，不是 toggle —— 传目标值）
export async function togglePin(characterId, pinned) {
  return request(`/characters/${characterId}/pin`, { method: 'PUT', body: { pinned } })
}

// 开关角色的日程生成：关闭后不再刷 LLM 生成日程（省 token），
// 已生成的日程模板保留，角色仍按既有日程活动，只是内容不再变化
export async function setCharacterScheduleEnabled(characterId, enabled) {
  return request(`/characters/${characterId}/schedule-enabled`, { method: 'PUT', body: { enabled } })
}

// 批量开关全体角色的日程生成（「全量省 token」入口）
export async function setAllCharactersScheduleEnabled(enabled) {
  return request('/characters/schedule-enabled-all', { method: 'POST', body: { enabled } })
}

// 归档 / 取消归档：归档后该角色不再参与任何主动行为（主动聊天、朋友圈、奇遇、
// 日程刷新、自己拉群、小镇奇遇），仅保留角色卡数据与「你主动找它时仍会回复」
export async function setCharacterArchived(characterId, archived) {
  return request(`/characters/${characterId}/archived`, { method: 'PUT', body: { archived } })
}

// 批量归档 / 取消归档全体角色
export async function setAllCharactersArchived(archived) {
  return request('/characters/archived-all', { method: 'POST', body: { archived } })
}

// ── 角色文件夹（单层分类）──
export function listCharacterFolders() {
  return request('/characters/folders')
}

export function createCharacterFolder(name) {
  return request('/characters/folders', { method: 'POST', body: { name } })
}

export function renameCharacterFolder(id, name) {
  return request(`/characters/folders/${id}`, { method: 'PUT', body: { name } })
}

export function deleteCharacterFolder(id) {
  return request(`/characters/folders/${id}`, { method: 'DELETE' })
}

/** 重排文件夹顺序（拖拽排序），ids 为期望的先后顺序 */
export function reorderCharacterFolders(ids) {
  return request('/characters/folders/reorder', { method: 'PUT', body: { ids } })
}

// folderId 传 null 表示移回「未分类」
export function moveCharacterToFolder(characterId, folderId) {
  return request(`/characters/${characterId}/folder`, { method: 'PUT', body: { folder_id: folderId } })
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

// ── 场景服装（工装/外出/居家/睡眠，由日程决定穿哪套）──

/** 该角色的场景服装 + 场景定义 */
export function listSceneOutfits(characterId) {
  return request(`/characters/${characterId}/outfits/scene`)
}

/** 此刻按日程该穿哪套（用于界面展示/调试） */
export function getCurrentSceneOutfit(characterId) {
  return request(`/characters/${characterId}/outfit-now`)
}

/**
 * 用 LLM 生成/补全场景外观；save=true 时直接落库。
 * @param {object} [extra]
 * @param {Array<{scene,name,body,description}>} [extra.seeds] **已填好的分项**，作为反推锚点；
 *   本次只补未填的那些（身体取自锚点，只生成该套衣服）
 * @param {string[]} [extra.scenes] 只补这几套；不传则由后端挑未填的
 * @param {string} [extra.baseAppearance] 没有任何 seed 时的身体来源兜底（如角色卡外观段）
 */
export function generateSceneOutfits(characterId, save = false, extra = {}) {
  return request(`/characters/${characterId}/outfits/generate`, { method: 'POST', body: { save, ...extra } })
}

/**
 * 批量保存五套场景外观（同场景已存在则更新）。
 * @param {Array<{scene,name,description}>} outfits description 只填"这一套的衣服"
 * @param {string} [body] 身体描述 —— 单一真源，后端会同步写进该角色全部服装行
 */
export function saveSceneOutfits(characterId, outfits, body) {
  return request(`/characters/${characterId}/outfits/scene`, {
    method: 'PUT',
    body: body != null ? { outfits, body } : { outfits },
  })
}

// ── 场景立绘（工装/私服/居家/睡衣四套形象，详情页左右切换）──

/** 四套场景立绘（未生成的场景返回空图；工装槽以默认立绘兜底） */
export function listSceneStandings(characterId) {
  return request(`/characters/${characterId}/standings`)
}

/** 生成某场景的立绘（LLM 出提示词 → 出图 → 落库；传 prompt 则直接复用，不再请求 LLM） */
export function generateSceneStanding(characterId, scene, requirement = '', prompt = '') {
  return request(`/characters/${characterId}/standings/generate`, { method: 'POST', body: { scene, requirement, prompt } })
}

/** 上传本地图片作为某场景立绘（base64 data URL） */
export function uploadSceneStanding(characterId, scene, base64) {
  return request(`/characters/${characterId}/standings/upload`, { method: 'POST', body: { scene, base64 } })
}

/** 清掉某场景的显式立绘（工装槽会回落到默认立绘） */
export function deleteSceneStanding(characterId, scene) {
  return request(`/characters/${characterId}/standings/${encodeURIComponent(scene)}`, { method: 'DELETE' })
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

// ── 我的表情库（用户自己的表情包，跨角色通用）──

export function listUserEmojis() {
  return request(`/user-emoji`)
}

export function uploadUserEmoji(key, base64) {
  return request(`/user-emoji/${encodeURIComponent(key)}/upload`, {
    method: 'POST',
    body: { base64 },
  })
}

export function deleteUserEmoji(key) {
  return request(`/user-emoji/${encodeURIComponent(key)}`, { method: 'DELETE' })
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

/** 修正外观：上传参考图（base64 data URL）+ 当前整卡文本（可为待确认的草稿卡），邻舍分析后重写「## 你的外观」（不入库，由前端回填）
 *  sceneLabel 用于按场景追加硬性约束（如睡衣必须赤脚）——原先没传，导致修睡衣与修工装走同一条提示词。 */
export function refineAppearanceDraft({ image, basePrompt, displayName, sceneLabel }) {
  return request('/characters/refine-appearance-draft', {
    method: 'POST',
    body: { image, base_prompt: basePrompt, display_name: displayName, scene_label: sceneLabel },
  })
}

/** 修正外观·文字模式：按纯文字要点扩写外观描述（不出图，只走文本 LLM；不入库，由前端回填） */
export function expandAppearanceDraft({ brief, basePrompt, displayName, sceneLabel }) {
  return request('/characters/expand-appearance-draft', {
    method: 'POST',
    body: { brief, base_prompt: basePrompt, display_name: displayName, scene_label: sceneLabel },
  })
}

/**
 * 人设润色：让邻舍改写人格提示词（外观段原样保留），只出草稿不落库，由父级决定是否保存。
 * @param {object} p
 * @param {string} p.basePrompt 整卡正文
 * @param {string} [p.displayName] 角色名
 * @param {string} [p.mode] 可选预设（polish/enrich/concise）；留空表示只用自定义指令
 * @param {string} [p.instruction] 用户**手写的自定义润色要求**（可空）
 */
export function refinePersonaDraft({ basePrompt, displayName, mode, instruction }) {
  return request('/characters/refine-persona-draft', {
    method: 'POST',
    body: { base_prompt: basePrompt, display_name: displayName, mode, instruction },
  })
}

/** 生成角色立绘任务（已有立绘时走对比确认，requirement 为额外需求 / prompt 为直接复用提示词） */
export function generateStandingTask(characterId, body = {}) {
  return request(`/characters/${characterId}/generate-standing-task`, { method: 'POST', body })
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

// intimacy 可选（0 泛泛 / 1 熟悉 / 2 亲近 / 3 亲密）；省略时后端按关系文本推断
export async function createRelationship(from_character_id, to_character_id, relationship_text, intimacy) {
  return request(`/relationships`, {
    method: 'POST',
    body: { from_character_id, to_character_id, relationship_text, ...(intimacy === undefined ? {} : { intimacy }) },
  })
}

// 省略 intimacy 时后端保留已显式设定的值（不会因改错字而丢失手工调整）
export async function updateRelationship(id, relationship_text, intimacy) {
  return request(`/relationships/${id}`, {
    method: 'PUT',
    body: { relationship_text, ...(intimacy === undefined ? {} : { intimacy }) },
  })
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

// 上传一张聊天图片（base64 data URI → 返回 /images/chat/... 路径），发图前先调它
export function uploadChatImage(base64) {
  return request('/chat/upload-image', { method: 'POST', body: { base64 } })
}

export function chatStream(characterId, message, clientMsgId, imageMode = 'smart', deepThink = false, townContext, images = null) {
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
            body: JSON.stringify({ message, client_msg_id: clientMsgId, image_mode: imageMode, force_image_gen: imageMode === 'force', deep_think: !!deepThink, ...(Array.isArray(images) && images.length ? { images } : {}), ...(townContext === undefined ? {} : { townContext }) }),
            signal: attemptCtrl.signal,
          })
          if (res.ok) break  // 成功
          if (townContext !== undefined && [400, 409].includes(res.status)) {
            const detail = await res.json().catch(() => ({}))
            const error = Object.assign(new Error(detail.error || '小镇对话暂时不可用，请重新选择邻居'), { status: res.status, code: detail.code || 'TOWN_CHAT_REJECTED' })
            outerController.error(error)
            return // Admission errors must never retry or fall back to an ordinary request.
          }
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

/** 设置群头像（base64 png）；传空值 = 恢复默认的成员拼图 */
export async function uploadGroupAvatar(id, base64) {
  return request(`/groups/${id}/avatar`, { method: 'POST', body: { base64 } })
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
  return request(`/config/comfy`, { method: 'PUT', body: data })
}

export async function fetchLorasFiles() {
  return request(`/config/loras-files`)
}

export async function updateGlobalLora(loras) {
  await request(`/config/global-lora`, { method: 'PUT', body: { loras } })
}

/** 更新 HiresFix 细化专用 LoRA（仅作用于放大细化工作流） */
/** 更新 HiresFix 细化完整设置（LoRA + 步数/重绘幅度/CFG） */
export function updateHiresSettings({ loras, steps, cfg, denoise, maxSize, artistMode, artist, samplingMode, globalLoraScale, sourceBlend, upscaleModel, workflowMode }) {
  return request(`/config/hires`, { method: 'PUT', body: { loras, steps, cfg, denoise, maxSize, artistMode, artist, samplingMode, globalLoraScale, sourceBlend, upscaleModel, workflowMode } })
}

export async function updateFeatureFlag(key, value) {
  await request(`/config/features`, { method: 'PUT', body: { key, value } })
}

// ── 角色操作反馈（右下角轻通知）──

/** 本次候选需要的素材：该角色启用表情包配置单里已完成的图片 + 头像（不做任何生成） */
export function getCharacterReactionAssets(characterId) {
  return request(`/characters/${characterId}/reaction-assets`)
}

/** 低概率即时反应：一次获准事件至多一次请求，由后端校验事实与额度 */
export function requestCharacterReaction(payload, { signal } = {}) {
  return request(`/character-reactions/instant`, { method: 'POST', body: payload, signal })
}

/** 短句包（M2）：按角色读取 / 用户主动生成 / 删除。只有 generate 会产生模型调用 */
export function getCharacterReactionPack(characterId) {
  return request(`/character-reactions/packs/${characterId}`)
}

export function generateCharacterReactionPack(characterId, eventTypes) {
  const body = Array.isArray(eventTypes) ? { eventTypes } : {}
  return request(`/character-reactions/packs/${characterId}/generate`, { method: 'POST', body })
}

export function deleteCharacterReactionPack(characterId) {
  return request(`/character-reactions/packs/${characterId}`, { method: 'DELETE' })
}

/** 保存用户手动编辑的短句包（服务端走同一套严格校验） */
export function saveCharacterReactionPack(characterId, pack) {
  return request(`/character-reactions/packs/${characterId}`, { method: 'PUT', body: { pack } })
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
export function updateGroupActivity(value) {
  return request('/config/group-activity', { method: 'PUT', body: { value } })
}

export function updateGroupSummaryInterval(value) {
  return request(`/config/group-summary-interval`, { method: 'PUT', body: { value } })
}

/** 更新奇遇触发频率 0~1 */
export async function updateEventFreq(value) {
  await request(`/config/event-freq`, { method: 'PUT', body: { value } })
}

/** 更新朋友圈发帖频率（0~3，1=默认 2~8 小时一条，0=关闭自动发帖） */
export async function updateMomentFreq(value) {
  await request(`/config/moment-freq`, { method: 'PUT', body: { value } })
}

/** 更新日程刷新周期（天，1~3） */
export async function updateScheduleRefreshDays(value) {
  await request(`/config/schedule-refresh-days`, { method: 'PUT', body: { value } })
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
async function jsonRequest(url, options) {
  const res = await fetch(url, options)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(data.error || `Request failed (${res.status})`), { status: res.status, code: data.code, requestId: data.requestId, characterId: data.characterId })
  return data
}

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

// 记忆系统体检：当前生效配置 + 缺失项 + 每条问题的处置建议（设置页展示用）
export function getMemoryHealth() {
  return request(`/memory/health`)
}

// 阶段三：整理 daemon 运行状态 + 待整理候选数
export function getConsolidationState() {
  return request(`/memory/consolidation/state`)
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
/**
 * 分页拉取朋友圈帖子（服务端 keyset 分页：发布时间、id 倒序，before_id 定位时间游标）
 * @param {{ limit?: number, beforeId?: number }} opts 缺省 limit=1000；传 beforeId 续拉下一批
 */
export async function listMoments({ limit, beforeId } = {}) {
  const params = new URLSearchParams()
  if (limit) params.set('limit', limit)
  if (beforeId) params.set('before_id', beforeId)
  const qs = params.toString()
  return request(`/moments${qs ? `?${qs}` : ''}`)
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

export async function updateMoment(postId, content) {
  return request(`/moments/${postId}`, { method: 'PUT', body: { content } })
}

export async function deleteMoment(id) {
  return request(`/moments/${id}`, { method: 'DELETE' })
}

export async function commentMoment(postId, content, replyToCommentId = null) {
  return request(`/moments/${postId}/comments`, {
    method: 'POST',
    body: { content, reply_to_comment_id: replyToCommentId },
  })
}

/** 用户自己发朋友圈（文字 + 可选 base64 图片数组），角色随后陆续来评论 */
export async function createUserMoment({ content, images = [] }) {
  return request(`/moments/user-post`, { method: 'POST', body: { content, images } })
}

export async function deleteMomentComment(postId, commentId) {
  return request(`/moments/${postId}/comments/${commentId}`, { method: 'DELETE' })
}

export async function likeMoment(postId) {
  return request(`/moments/${postId}/like`, { method: 'POST' })
}

/** 按帖子原本的提示词重新出图，补上因生图失败缺失的配图 */
export async function regenerateMomentImage(postId) {
  return request(`/moments/${postId}/regenerate-image`, { method: 'POST' })
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

// ── ComfyUI health ──
export async function comfyuiHealth() {
  try {
    return await request(`/images/comfyui-health`)
  } catch { return { connected: false } }
}

export async function imageProviderHealth(data = {}) {
  try {
    return await request(`/images/provider-health`, { method: 'POST', body: data })
  } catch { return { connected: false, provider: data.provider || 'comfyui' } }
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
export function listGalleryImages(limit = 100, offset = 0, folder = '', characterId = null) {
  let path = `/images/gallery?limit=${limit}&offset=${offset}`
  if (folder) path += `&folder=${encodeURIComponent(folder)}`
  if (characterId) path += `&character=${encodeURIComponent(characterId)}`
  return request(path)
}

/**
 * 批量删除图片（相册多选用）。后端逐张删除、只失效一次相册缓存。
 * @returns {Promise<{success:boolean, deleted:number, failed:number, failedItems:Array}>}
 */
export function deleteImagesBatch(urls) {
  return request(`/images/delete-batch`, { method: 'POST', body: { urls } })
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

// 日程台账（长期观测：八股/稳定性/风险）
export function getScheduleLedger() {
  return request(`/schedule/ledger`)
}

export function getCharacterScheduleLedger(characterId) {
  return request(`/schedule/ledger/${characterId}`)
}

export function getCharacterSchedule(characterId) {
  return request(`/schedule/${characterId}`)
}

export function getCurrentActivity(characterId) {
  return request(`/schedule/${characterId}/current`)
}

/** 编辑单条日程（标记为已编辑，进入当天特殊朋友圈队列） */
export function updateScheduleActivity(characterId, index, patch) {
  return request(`/schedule/${characterId}/activity`, { method: 'PUT', body: { index, ...patch } })
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

/**
 * 重新生成单个角色的日程。
 * @param {number} characterId
 * @param {string} [direction] 补充说明（原「日程方向」文本框）
 * @param {object} [options]  本次编排约束：{ areas, areaStrict, nsfwRatio, sleepType, mapId }
 *                            **全部省略时请求体与旧版完全一致**（行为不变）
 */
export function regenerateSchedule(characterId, direction, options = {}) {
  const body = {}
  if (direction) body.direction = direction
  if (options && typeof options === 'object') {
    if (Array.isArray(options.areas) && options.areas.length) {
      body.areas = options.areas
      if (options.areaStrict) body.areaStrict = true
      if (options.mapId) body.mapId = options.mapId
    }
    if (options.nsfwRatio !== undefined && options.nsfwRatio !== null) body.nsfwRatio = options.nsfwRatio
    if (options.sleepType && options.sleepType !== 'auto') body.sleepType = options.sleepType
  }
  return request(`/schedule/${characterId}/regenerate`, { method: 'POST', body })
}

/** 日程弹窗的全部选项（区域 / NSFW 档位 / 睡眠类型），档位由后端定义、前端只渲染 */
export function getRegenerateOptions(mapId) {
  const q = mapId ? `?mapId=${encodeURIComponent(mapId)}` : ''
  return request(`/schedule/regenerate-options${q}`)
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

export async function updateWorkflowMode(mode, customTemplate) {
  const body = { mode }
  // mode === 'custom' 时一并提交全局自定义工作流文件名
  if (customTemplate !== undefined) body.customTemplate = customTemplate
  return request(`/config/workflow-mode`, { method: 'PUT', body })
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

// ── 角色日记 ──

/** 取某个角色某一天的日记（date 省略 = 今天） */
export function getDiary(characterId, date) {
  const q = date ? `?date=${encodeURIComponent(date)}` : ''
  return request(`/diaries/${characterId}${q}`)
}

/** 历史日记简目（最新在前，供日记本翻页导航） */
export function listDiaries(characterId, limit = 60) {
  return request(`/diaries/${characterId}/history?limit=${limit}`)
}

/** 生成 / 重新生成某一天的日记（后台执行，进度走 SSE 与右下角生成提示） */
export function generateDiary(characterId, date) {
  const body = {}
  if (date) body.date = date
  return request(`/diaries/${characterId}/generate`, { method: 'POST', body })
}

// ── 《邻舍日报》预告报纸 ──

export async function getTodayNewspaper() {
  return request(`/newspaper/today`)
}

// 历史期简目（最新在前，供期号导航）
export async function listNewspaperEditions() {
  return request(`/newspaper/editions`)
}

// 按日期回看某一期
export async function getNewspaperByDate(date) {
  return request(`/newspaper/by-date/${date}`)
}

export async function generateNewspaper() {
  return request(`/newspaper/generate`, { method: 'POST' })
}

export async function regenerateTodayNewspaper() {
  return request('/newspaper/regenerate', { method: 'POST' })
}

// 手动补印一张缺失的报纸配图（slot: lead=特稿 / world=今日异闻 / item=普通新闻，index 为新闻下标；
// date 省略 = 今天，带日期可给历史期补图）
export async function regenerateNewspaperImage({ slot, index, date } = {}) {
  return request(`/newspaper/regenerate-image`, { method: 'POST', body: { slot, index, date } })
}

// 消除/恢复今天的世界影响（异闻不再/重新注入角色提示词）
export async function dismissNewspaperWorldState(dismissed) {
  return request(`/newspaper/dismiss-world`, { method: 'POST', body: { dismissed } })
}

// 删除某一期（连同它的配图文件）
export async function deleteNewspaperEdition(date) {
  return request(`/newspaper/editions/${date}`, { method: 'DELETE' })
}

/**
 * 批量清除往期。
 * @param {{ keep?: 'today'|'none', before?: string|null }} opts
 *   keep='today'（默认）只清往期、保留今天；'none' 连今天一起清空
 *   before='YYYY-MM-DD' 只清该日期之前（不含）的期
 */
export async function clearNewspaperEditions({ keep = 'today', before = null } = {}) {
  let path = `/newspaper/editions?keep=${encodeURIComponent(keep)}`
  if (before) path += `&before=${encodeURIComponent(before)}`
  return request(path, { method: 'DELETE' })
}


// ── 事件库管理（奇遇事件类型 / 朋友圈话题）──

export async function listEventTypes() {
  return request(`/library/event-types`)
}

export function describeLibraryImage(type, image, direction, signal) {
  return request('/library/describe-image', { method: 'POST', body: { type, image, direction }, signal })
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

// 批量勾选 / 取消勾选话题（决定参不参与抽题，条目本身保留）
// 传 { all: true } 表示全选/清空，或 { ids: [...] } 指定条目
export function setTopicsChecked({ ids = null, all = false, checked }) {
  return request(`/library/topics/set-checked`, { method: 'POST', body: { ids, all, checked } })
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

// 开启每日宝箱（冷却由后端 CHEST_COOLDOWN_SECONDS 决定，本地为 1 分钟；道具图片异步生成，完成后经 item_ready 事件刷新）
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

// ── 宝箱橱窗（分页浏览商品 → 挑选 → 带走）──

/** 分页配置 + 各页可选商品数 */
export function getLootPages() {
  return request('/loot/pages')
}

/**
 * 某页当前橱窗（4 个格子，未刷新过时全为空位）。
 * @param {boolean} [ensure] true 时把缺图的格子补进生图队列 —— 打开橱窗时用，
 *   这样卡上的「生成中」是真的在生成、且一定会完成（轮询兜底不要传，避免反复塞队列）
 */
export function getLootWindow(page, ensure = false) {
  return request(`/loot/window?page=${encodeURIComponent(page)}${ensure ? '&ensure=1' : ''}`)
}

/** 给缺图的商品排队补图（管理用）；传 tags 只补指定几件 */
export function repairLootImages({ limit = 50, tags = null } = {}) {
  return request('/loot/repair-images', { method: 'POST', body: { limit, tags } })
}

/** 刷新某页（重抽 8 个；缺图的会异步排队生成，完成后经 loot_image_ready 事件推送） */
export function rollLootWindow(page) {
  return request('/loot/window/roll', { method: 'POST', body: { page } })
}

/** 带走选中的格子（写进背包），slots 为格子下标数组 */
export function takeLootItems(page, slots) {
  return request('/loot/window/take', { method: 'POST', body: { page, slots } })
}

/** 丢弃橱窗里的一格（不带走、不进背包，只把候选项划掉） */
export function discardLootSlot(page, slot) {
  return request('/loot/window/discard', { method: 'POST', body: { page, slot } })
}

// ── AI 小镇（世界页）──

// 全量快照：地图/POI/agents/玩家/天气/活跃相遇
// mapId 省略 = 玩家当前那张图；显式指定用于出行前预载目标图（不含玩家坐标）
export function fetchTownState(mapId = null) {
  return jsonRequest(`${BASE}/town/state${mapId != null ? `?mapId=${encodeURIComponent(mapId)}` : ''}`)
}

// 出行目录：所有小镇（含居民数与建成状态）+ 玩家所在地图 + 场景修订号
export function fetchTownMaps() {
  return jsonRequest(`${BASE}/town/maps`)
}

// 给一座小镇改名（只动名字，不重写图层与 POI）
export function renameTownMap(mapId, name) {
  return jsonRequest(`${BASE}/town/maps/${encodeURIComponent(mapId)}`, townJson('PATCH', { name }))
}

// 出行：把玩家搬到另一张图。expectedPlayerRevision 用于并发时只让第一个请求生效
export function travelTown(targetMapId, { expectedPlayerRevision = null, worldId, worldEpoch } = {}) {
  return jsonRequest(`${BASE}/town/travel`, townJson('POST', { targetMapId, expectedPlayerRevision, worldId, worldEpoch }))
}

// 世界页在线打点：TownView 挂载期间定期调用，服务端据此开启相遇/气泡等页面演出
export function townViewerHeartbeat() {
  return jsonRequest(`${BASE}/town/viewer/heartbeat`, townJson('POST'))
}

// 居民详细状态（需求/心情/目标/技能/最近来往，只读展示层）
export function fetchTownActorStatus(actorId) {
  return jsonRequest(`${BASE}/town/actors/${encodeURIComponent(actorId)}/status`)
}

// 居民活动流水（只读展示层）：全镇信息流（左上角浮窗/动态面板）+ 单居民行动记录
export function fetchTownActivity(limit = 40) {
  return jsonRequest(`${BASE}/town/activity?limit=${encodeURIComponent(limit)}`)
}
export function fetchTownActorActivity(actorId, limit = 100) {
  return jsonRequest(`${BASE}/town/actors/${encodeURIComponent(actorId)}/activity?limit=${encodeURIComponent(limit)}`)
}

// 玩家 token 移动（服务端寻路 + town_move 广播）；带 mapId 让跨图后的旧请求被服务端拒掉
export function moveTownPlayer(x, y, { worldId, worldEpoch, mapId } = {}) {
  return jsonRequest(`${BASE}/town/player/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ x, y, worldId, worldEpoch, ...(mapId != null ? { mapId } : {}) }),
  })
}

// 相遇对话记录
export function fetchTownEncounterMessages(encounterId) {
  return jsonRequest(`${BASE}/town/encounters/${encounterId}/messages`)
}

// 小镇角色名单（在场状态）
export function fetchTownCharacters() {
  return jsonRequest(`${BASE}/town/characters`)
}

// ── AI 小镇 v2：素材库 / 瓦片地图 / 初始化向导 / 轻量居民 ──

function townJson(method, body) {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  }
}

// 素材库
export function fetchTownAssets(kind = null) {
  return jsonRequest(`${BASE}/town/assets${kind ? `?kind=${encodeURIComponent(kind)}` : ''}`)
}

export function createTownAsset(payload) {
  return jsonRequest(`${BASE}/town/assets`, townJson('POST', payload))
}

export function regenerateTownAsset(id, overrides = {}) {
  return jsonRequest(`${BASE}/town/assets/${id}/regenerate`, townJson('POST', overrides))
}

export function deleteTownAsset(id) {
  return jsonRequest(`${BASE}/town/assets/${id}`, { method: 'DELETE' })
}

export function fetchTownAsset(id) {
  return jsonRequest(`${BASE}/town/assets/${id}`)
}

export function regenerateTownAssetPrompt(id, requirement, options = {}) {
  return jsonRequest(`${BASE}/town/assets/${id}/regenerate-prompt`, townJson('POST', { requirement, ...options }))
}

// 保存单张素材的画师串 / LoRA / 固定前缀
export function updateTownAssetGeneration(id, payload) {
  return jsonRequest(`${BASE}/town/assets/${id}/generation`, townJson('PATCH', payload))
}
// 保存前端编辑后的素材图（点击抠除颜色 / 裁剪，dataUrl PNG）
export function saveTownAssetImage(id, dataUrl) {
  return jsonRequest(`${BASE}/town/assets/${id}/image`, townJson('POST', { dataUrl }))
}

// 手动上传本地图片替换素材（base64 dataUrl）：后端按素材规格走生成同款后处理
export function uploadTownAssetImage(id, dataUrl) {
  return jsonRequest(`${BASE}/town/assets/${id}/upload`, townJson('POST', { dataUrl }))
}
// 按截取框裁剪素材并覆盖（放大查看后划定最终成图范围）
export function cropTownAsset(id, rect) {
  return jsonRequest(`${BASE}/town/assets/${id}/crop`, townJson('POST', rect))
}

// 地砖专用：按菱形框（x/y/w，高 = 宽 / 2）在裁剪前原图上重裁并覆盖成品
export function cropTownTileAsset(id, diamond) {
  return jsonRequest(`${BASE}/town/assets/${id}/crop-tile`, townJson('POST', diamond))
}

// 小镇立绘 HiresFix 细化（按全局 HiresFix 设置覆盖原图）
export function refineTownAssetHires(id) {
  return jsonRequest(`${BASE}/town/assets/${id}/hires`, townJson('POST', {}))
}

// 地图（编辑器保存 / 渲染载荷）；mapId 省略 = 玩家当前那张图
export function fetchTownMap(mapId = null) {
  return jsonRequest(`${BASE}/town/map${mapId != null ? `?mapId=${encodeURIComponent(mapId)}` : ''}`)
}

export function saveTownMap(payload) {
  return jsonRequest(`${BASE}/town/map`, townJson('PUT', payload))
}

// 天空远景：生成/重生成地图外圈的两层剪影（世界观 LLM 出词 + ComfyUI）
export function generateTownSkyBackdrops() {
  return jsonRequest(`${BASE}/town/sky-backdrops`, townJson('POST', {}))
}

// 初始化向导
export function fetchTownInitState() {
  return jsonRequest(`${BASE}/town/init`)
}

export function startTownInit(payload) {
  return jsonRequest(`${BASE}/town/init/start`, townJson('POST', payload))
}

export function updateTownBlueprint(blueprint) {
  return jsonRequest(`${BASE}/town/init/blueprint`, townJson('PUT', blueprint))
}

export function generateTownAssetPrompts(payload) {
  return jsonRequest(`${BASE}/town/init/asset-prompts`, townJson('POST', payload))
}

export function generateTownSamples() {
  return jsonRequest(`${BASE}/town/init/samples`, townJson('POST', {}))
}

export function startTownBatch() {
  return jsonRequest(`${BASE}/town/init/batch`, townJson('POST', {}))
}

export function fetchTownInitPreview() {
  return jsonRequest(`${BASE}/town/init/preview`)
}

export function generateTownLayout() {
  return jsonRequest(`${BASE}/town/init/layout`, townJson('POST', {}))
}

export function rerollTownLayout() {
  return jsonRequest(`${BASE}/town/init/reroll`, townJson('POST', {}))
}

// 向导居民步：按蓝图提前建档居民（稳定人格卡）
export function commitTownWizardNpcs() {
  return jsonRequest(`${BASE}/town/init/npcs`, townJson('POST', {}))
}

// 向导居民步：按数量重新生成名单（拉条）
export function regenerateTownNpcRoster(count) {
  return jsonRequest(`${BASE}/town/init/npc-roster`, townJson('POST', { count }))
}

export function confirmTownInit() {
  return jsonRequest(`${BASE}/town/init/confirm`, townJson('POST', {}))
}

export function cancelTownInit() {
  return jsonRequest(`${BASE}/town/init`, { method: 'DELETE' })
}

// 轻量居民（NPC）
export function fetchTownNpcs() {
  return jsonRequest(`${BASE}/town/npcs`)
}

export function fetchTownNpc(id) {
  return jsonRequest(`${BASE}/town/npcs/${id}`)
}

export function createTownNpc(payload) {
  return jsonRequest(`${BASE}/town/npcs`, townJson('POST', payload))
}

export function updateTownNpc(id, payload) {
  return jsonRequest(`${BASE}/town/npcs/${id}`, townJson('PUT', payload))
}

export function deleteTownNpc(id) {
  return jsonRequest(`${BASE}/town/npcs/${id}`, { method: 'DELETE' })
}

export function generateTownNpcSprites(id, overrides = {}) {
  const body = { ...overrides }
  if (typeof body.refreshAppearance !== 'boolean') delete body.refreshAppearance
  return jsonRequest(`${BASE}/town/npcs/${id}/sprites`, townJson('POST', body))
}

export function generateTownNpcPortrait(id, overrides = {}) {
  return jsonRequest(`${BASE}/town/npcs/${id}/portrait`, townJson('POST', overrides))
}

/** 一次出齐全套素材（正面 / 背面 / 大立绘）：后端一次 LLM 返回三条提示词再分别出图 */
export function generateTownNpcAssetSet(id, overrides = {}) {
  const body = { ...overrides }
  if (typeof body.refreshAppearance !== 'boolean') delete body.refreshAppearance
  return jsonRequest(`${BASE}/town/npcs/${id}/asset-set`, townJson('POST', body))
}

export function regenerateTownNpcPersonaCard(id, overrides = {}) {
  return jsonRequest(`${BASE}/town/npcs/${id}/persona-card`, townJson('POST', overrides))
}

export function inviteTownNpc(id) {
  return jsonRequest(`${BASE}/town/npcs/${id}/invite`, townJson('POST', {}))
}

export function generateTownCharacterPortrait(characterId) {
  return jsonRequest(`${BASE}/town/characters/${characterId}/portrait`, townJson('POST', {}))
}

// 入住角色的全套素材（立绘 + 正/背小人；已有素材的环节后端自动跳过，force = true 时整套重新生成）
export function ensureTownCharacterAssets(characterId, options = {}) {
  return jsonRequest(`${BASE}/town/characters/${characterId}/assets`, townJson('POST', options?.force === true ? { force: true } : {}))
}

export function rerollTownNpc(id) {
  return jsonRequest(`${BASE}/town/npcs/${id}/reroll`, townJson('POST', {}))
}

export function fetchTownNpcMessages(id) {
  return jsonRequest(`${BASE}/town/npcs/${id}/messages`)
}

export function chatWithTownNpc(id, message, { clientMessageId, worldId, worldEpoch } = {}) {
  return jsonRequest(`${BASE}/town/npcs/${id}/chat`, townJson('POST', { message, clientMessageId, worldId, worldEpoch }))
}

// 入住角色开关
export function setTownCharacterEnabled(characterId, townEnabled) {
  return jsonRequest(`${BASE}/town/characters/${characterId}`, townJson('PUT', { townEnabled }))
}

// 入住角色的职能权限（打工 / 服务 / 交易，至少一项）
export function setTownCharacterCapabilities(characterId, capabilities) {
  return jsonRequest(`${BASE}/town/characters/${characterId}`, townJson('PUT', { capabilities }))
}

// 为酒馆角色建托管居民档案（服务 / 打工 / 货架项目落库用，幂等）
export function ensureTownCharacterProfile(characterId) {
  return jsonRequest(`${BASE}/town/characters/${characterId}/profile`, townJson('POST', {}))
}

// 角色四方向spirit生成（管理面板）
export function generateTownCharacterSprites(characterId, options = {}) {
  return jsonRequest(`${BASE}/town/characters/${characterId}/sprites`, townJson('POST',
    typeof options.refreshAppearance === 'boolean' ? { refreshAppearance: options.refreshAppearance } : {}))
}

// 玩家形象套装（立绘 + 正/背小人）
export function fetchTownPlayerKit() {
  return jsonRequest(`${BASE}/town/player/kit`)
}

export function regenerateTownPlayerKit(overrides = {}) {
  return jsonRequest(`${BASE}/town/player/kit`, townJson('POST', overrides))
}

export function regenerateTownPlayerSprite(direction, overrides = {}) {
  return jsonRequest(`${BASE}/town/player/sprites/${direction}`, townJson('POST', overrides))
}

// 小镇设置 / 世界重置
export function fetchTownSettings() {
  return jsonRequest(`${BASE}/town/settings`)
}

export function updateTownSettings(patch) {
  return jsonRequest(`${BASE}/town/settings`, townJson('PUT', patch))
}

export function relayoutTownMap() {
  return jsonRequest(`${BASE}/town/map/relayout`, townJson('POST', {}))
}

export function resetTownWorld() {
  return jsonRequest(`${BASE}/town/world`, { method: 'DELETE' })
}

// 重新初始化**一座小镇**：只清这一张图的地图/POI/居民/相遇，别的镇不受影响
export function resetTownMap(mapId) {
  return jsonRequest(`${BASE}/town/maps/${encodeURIComponent(mapId)}`, { method: 'DELETE' })
}
// 玩家方向键单步移动（本地节流上报）；带 mapId 让跨图后的旧按键请求被服务端拒掉
export function moveTownPlayerDir(dx, dy, { worldId, worldEpoch, mapId } = {}) {
  return jsonRequest(`${BASE}/town/player/dir`, townJson('POST', { dx, dy, worldId, worldEpoch, ...(mapId != null ? { mapId } : {}) }))
}

// 对话驻留：打开对话框时让对方停走（服务端租约制，开窗续租、关闭释放、失联自动过期）
export function holdTownActor(actorId, { worldId, worldEpoch } = {}) {
  return jsonRequest(`${BASE}/town/actors/${encodeURIComponent(actorId)}/hold`, townJson('POST', { worldId, worldEpoch }))
}

export function releaseTownActor(actorId, { worldId, worldEpoch } = {}) {
  return jsonRequest(`${BASE}/town/actors/${encodeURIComponent(actorId)}/release`, townJson('POST', { worldId, worldEpoch }))
}

export function carryTownActor(actorId, body) {
  return jsonRequest(`${BASE}/town/actors/${encodeURIComponent(actorId)}/carry`, townJson('POST', body))
}


export function regenerateTownPlayerPortrait(overrides = {}) {
  return jsonRequest(`${BASE}/town/player/portrait`, townJson('POST', overrides))
}

export { getTownWallet, executeTownLifeCommand, createTownTargetTradeCommand,
  fetchTownInteractions, offerTownInteraction, respondTownInteraction,
  fetchTownNpcFunctions, receiveTownNpcGift } from './townLife.js'


// 独立角色表情立绘；与普通立绘和小镇素材分开存储。
const expressionStandingPath = (id, slot = '') => `/characters/${id}/expression-standings${slot ? '/' + encodeURIComponent(slot) : ''}`
export const getStandingOverview = () => request('/expression-standings/overview')
export const generateAllExpressionStandings = body => request('/expression-standings/generate', { method: 'POST', body })
export const listExpressionStandings = id => request(expressionStandingPath(id))
export const generateExpressionStandings = (id, body) => request(expressionStandingPath(id) + '/generate', { method: 'POST', body })
export const controlExpressionStandingTask = (id, jobId, action) => request(expressionStandingPath(id) + `/jobs/${encodeURIComponent(jobId)}/${action}`, { method: 'POST' })
export const updateExpressionStandingPrompt = (id, slot, prompt, generation) => request(expressionStandingPath(id, slot) + '/prompt', { method: 'PATCH', body: { prompt, generation } })
export const editExpressionStanding = (id, slot, action, body = {}) => request(expressionStandingPath(id, slot) + '/' + action, { method: 'POST', body })
export const deleteExpressionStanding = (id, slot) => request(expressionStandingPath(id, slot), { method: 'DELETE' })
export const getStandingDisplayState = () => request('/standing-display/state')
export const getStandingInteraction = id => request(`/characters/${id}/standing-interaction`)
export const getStandingTouchLines = id => request(`/characters/${id}/expression-standings/touch-lines`)
export const saveStandingTouchLines = (id, body) => request(`/characters/${id}/expression-standings/touch-lines`, {method:'PUT',body})
export const generateStandingTouchLines = (id, expectedVersion) => request(`/characters/${id}/expression-standings/touch-lines/generate`, {method:'POST',body:{expectedVersion}})
export const setStandingDisplayCharacter = body => request('/standing-display/active', { method: 'PUT', body })

export const fillAllStandingTouchLines = () => request('/expression-standings/touch-lines/fill', { method:'POST' })

export const backfillMoments = () => request('/moments/backfill', { method: 'POST' })

export const stopBackfillMoments = taskId => request(`/moments/backfill/${encodeURIComponent(taskId)}/stop`, { method: 'POST' })

// ── 媒体内容页（传媒 / 板块 / 帖子）──

/** 全部媒体（含板块数与帖子数） */
export function listMediaOutlets() {
  return request('/media/outlets')
}

/** 可选的媒体形态（社交平台 / 数字报刊）—— 两者产物格式差别很大，新建时必须选 */
export function listMediaLayouts() {
  return request('/media/layouts')
}

/** 某刊的期简目（往期导航用，最新在前） */
export function listMediaIssues(outletId) {
  return request(`/media/outlets/${outletId}/issues`)
}

/**
 * 出一刊（数字报刊形态专用）。
 * @param {boolean} [force] false 时「当天已出过」会直接返回那一期；true 则强制再出一期（加刊）
 */
export function publishMediaIssue(outletId, force = false) {
  return request(`/media/outlets/${outletId}/issue`, { method: 'POST', body: { force } })
}

export function createMediaOutlet(body) {
  return request('/media/outlets', { method: 'POST', body })
}

export function updateMediaOutlet(id, body) {
  return request(`/media/outlets/${id}`, { method: 'PUT', body })
}

export function deleteMediaOutlet(id) {
  return request(`/media/outlets/${id}`, { method: 'DELETE' })
}

/** 某媒体下的板块 */
export function listMediaBoards(outletId) {
  return request(`/media/outlets/${outletId}/boards`)
}

export function createMediaBoard(outletId, body) {
  return request(`/media/outlets/${outletId}/boards`, { method: 'POST', body })
}

export function updateMediaBoard(boardId, body) {
  return request(`/media/boards/${boardId}`, { method: 'PUT', body })
}

export function deleteMediaBoard(boardId) {
  return request(`/media/boards/${boardId}`, { method: 'DELETE' })
}

/** 帖子分页（不传 outlet 则跨媒体） */
export function listMediaPosts({ outlet = null, board = null, category = null, limit = 40, offset = 0 } = {}) {
  let path = `/media/posts?limit=${limit}&offset=${offset}`
  if (outlet) path += `&outlet=${encodeURIComponent(outlet)}`
  if (board) path += `&board=${encodeURIComponent(board)}`
  // 分类过滤：digital = 数字报刊（周刊/海报）；social = 社交平台（帖子流）
  if (category) path += `&category=${encodeURIComponent(category)}`
  return request(path)
}

/** 抓一批新帖（异步：返回 started 后靠 SSE media_new_posts 得知完成） */
export function refreshMediaPosts(body = {}) {
  return request('/media/refresh', { method: 'POST', body })
}

/** 催一次封面补印 */
export function fillMediaImages(limit = 6) {
  return request('/media/fill-images', { method: 'POST', body: { limit } })
}

/** 传媒自动抓帖状态（当前档位 + 距下次还有多久 + 可选档位表） */
export function getMediaAuto() {
  return request('/media/auto')
}

/**
 * 改传媒自动抓帖频率：`perNight` = **每晚几批**（0 = 关闭，只手动刷新）。
 *
 * ★ 2026-10-05 语义变更：由「固定间隔（分钟）」改成「每晚几批」。
 *   自动抓帖只在**夜间窗口**（20:00→次日 02:00）内**错峰随机**执行，白天不产新内容；
 *   每批只出 1 条（`mediaService.AUTO_BATCH_SIZE`）。
 *   可用档位由 `GET /media/auto` 的 `steps` 下发，界面上就是一个滑块。
 */
export function setMediaAuto(perNight) {
  return request('/media/auto', { method: 'PUT', body: { perNight } })
}

/** 清理未被引用的孤儿配图（重复生图的历史遗留）+ 重置卡住的生成状态 */
export function cleanupMediaImages() {
  return request('/media/cleanup-images', { method: 'POST' })
}

// ── 数据清理（按时间清理图片与内容记录）──

/** 可清理项定义（界面据此渲染分组与说明） */
export function getCleanupTargets() {
  return request('/cleanup/targets')
}

/** 预览：指定天数前，各项会删多少行/多少文件/多少字节（不删任何东西） */
export function surveyCleanup(days = 7) {
  return request(`/cleanup/survey?days=${encodeURIComponent(days)}`)
}

/**
 * 执行清理。**必须显式传 targets**；执行前会自动备份数据库（路径随响应返回）。
 * @param {{days:number, targets:string[]}} body
 */
export function purgeCleanup(body) {
  return request('/cleanup/purge', { method: 'POST', body })
}

/** 已有的清理前备份 */
export function listCleanupBackups() {
  return request('/cleanup/backups')
}

/** 为某条媒体内容重新生成配图（周刊/海报会连同小图一起重出） */
export function regenerateMediaPostImage(postId) {
  return request(`/media/posts/${postId}/regenerate-image`, { method: 'POST' })
}

/** 删除某条媒体内容（配图文件一并删除） */
export function deleteMediaPost(postId) {
  return request(`/media/posts/${postId}`, { method: 'DELETE' })
}

/** 批量删除媒体内容。ids 为帖子 id 数组，返回逐条结果（成功数 / 失败明细） */
export function deleteMediaPosts(ids) {
  return request('/media/posts/batch', { method: 'DELETE', body: { ids } })
}

/** 批量重新生图（清空旧图并置回待生成队列） */
export function regenerateMediaPostImages(ids) {
  return request('/media/posts/batch/regenerate-image', { method: 'POST', body: { ids } })
}

/**
 * 门户：生成（或读取缓存的）某个板块的正文。
 * 已生成过后端直接返回缓存（二次点开秒开）；首次要调 LLM，所以是同步等待。
 */
export function generateMediaSection(postId, sectionKey) {
  return request(`/media/posts/${postId}/sections/${encodeURIComponent(sectionKey)}`, { method: 'POST' })
}

// ── 地图页（世界地图骨架 = 叙事地理，非游戏网格图）──

/** 层级标签与 POI 类型（口径在后端，前端不写死） */
export function getWorldMapMeta() {
  return request('/worldmap/meta')
}

export function listWorldMaps() {
  return request('/worldmap/maps')
}

export function createWorldMap({ name, worldSettingId = null, note = '' } = {}) {
  return request('/worldmap/maps', { method: 'POST', body: { name, worldSettingId, note } })
}

export function getWorldMap(mapId) {
  return request(`/worldmap/maps/${mapId}`)
}

export function updateWorldMap(mapId, patch = {}) {
  return request(`/worldmap/maps/${mapId}`, { method: 'PUT', body: patch })
}

export function deleteWorldMap(mapId) {
  return request(`/worldmap/maps/${mapId}`, { method: 'DELETE' })
}

/** 复制一张地图（整棵子树）为新地图 —— 用作「新建时套模板」 */
export function duplicateWorldMap(mapId, name = '') {
  return request(`/worldmap/maps/${mapId}/duplicate`, { method: 'POST', body: { name } })
}

/** ① 生成骨架（L1 大地区 + L2 子地区，1 次短 LLM） */
export function generateWorldMapSkeleton(mapId, { brief = '', regionCount, districtPerRegion } = {}) {
  return request(`/worldmap/maps/${mapId}/generate`, {
    method: 'POST', body: { brief, regionCount, districtPerRegion },
  })
}

/** 导出 Markdown（贴回知识库用） */
export function exportWorldMapMarkdown(mapId) {
  return request(`/worldmap/maps/${mapId}/export`)
}

export function addWorldMapPlace(mapId, place) {
  return request(`/worldmap/maps/${mapId}/places`, { method: 'POST', body: place })
}

export function updateWorldMapPlace(placeId, patch) {
  return request(`/worldmap/places/${placeId}`, { method: 'PUT', body: patch })
}

export function deleteWorldMapPlace(placeId) {
  return request(`/worldmap/places/${placeId}`, { method: 'DELETE' })
}

/** ② 逐区展开（L3 场景 + 每场景 POI；重复调用 = 换一批） */
export function expandWorldMapPlace(placeId) {
  return request(`/worldmap/places/${placeId}/expand`, { method: 'POST' })
}
