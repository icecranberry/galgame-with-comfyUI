import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import * as api from '../api/index.js'
import { useMessageWindow } from '../composables/useMessageWindow.js'
import { useProactiveStore } from './notifications.js'
import { emitCharacterAvatarChanged } from '../utils/characterReactionProducers.js'
import { chatSpeechAutoPlay } from '../utils/speechAutoPlay.js'
import { onEvent } from './unifiedStream.js'

let _seq = Date.now()
function uid() { return ++_seq }
function isEmojiImageUrl(url) {
  return typeof url === 'string' && url.includes('/images/emoji/')
}

export const useChatStore = defineStore('chat', () => {
  let streamSeq = 0
  let selectionSeq = 0
  let historySeq = 0
  let activeStream = null  // { charId, id, abort } | null
  let restoreAfterStream = false
  let imageRevision = 0

  function cancelActiveStream() {
    if (!activeStream) return
    try { activeStream.abort() } catch {}
    activeStream = null
  }

  function isCurrentStream(sessionId) {
    return !!activeStream && activeStream.id === sessionId
  }
  const characters = ref([])
  const activeCharId = ref(null)
  const messages = ref([])       // unified: { id, role, type, content, images, genId, genStatus, genStartTime, created_at }
  const queuedReplies = ref({}) // presentation only; authoritative delayed replies still use the original queue/SSE
  const streaming = ref(false)
  const streamingContent = ref('')
  const showTypingDots = ref(false)   // 打字动画：仅在发送后、首个 token 到达前显示一次
  const memoryRecalling = ref(false)  // Memory v3 阶段二：@memory 主动回想进行中（回想状态条）
  const guesses = ref(null)  // { a: string, b: string } | null — 回复候选词
  const guessSourceRawId = ref(null)
  const dialogueRevision = ref(0)
  const responseComplete = ref(false)
  const lastSendError = ref('')
  const realtimeAffinity = ref(null)  // { affinity, affinityDelta, lastReason } — SSE affinity_update 推送
  const affinityKey = ref(0)          // 仅 SSE 推送时递增，驱动 roll 动画；初始加载/切角色时不递增
  const sidebarScrollSignal = ref(0)  // 主动消息到达时递增，驱动 Sidebar 滚动到顶部
  const activeChar = computed(() => characters.value.find(c => c.id === activeCharId.value))

  function settleTurnImages(clientMsgId) {
    const start = messages.value.findIndex(m => m.role === 'user' && (m.clientMsgId || m.client_msg_id) === clientMsgId)
    if (start < 0) return
    const next = messages.value.findIndex((m, i) => i > start && m.role === 'user')
    const end = next < 0 ? messages.value.length : next
    const turn = messages.value.slice(start + 1, end)
    const pictures = turn.filter(m => m.independentTask)
    if (pictures.length) messages.value.splice(start + 1, turn.length, ...turn.filter(m => !m.independentTask), ...pictures)
  }

  function applyImageEvent(d) {
    if (Number(d.characterId) !== Number(activeCharId.value)) return
    imageRevision++
    let gm = messages.value.find(m => m.genId === d.taskId || (d.messageId && m.type === 'image_gen' && m.sourceMsgId === d.messageId))
    if (!gm) {
      gm = { id: uid(), role: 'assistant', type: 'image_gen', genId: d.taskId, independentTask: true,
        sourceMsgId: d.messageId, genStatus: 'pending', genStartTime: Date.now(), created_at: d.created_at || new Date().toISOString() }
      const user = messages.value.findIndex(m => m.role === 'user' && ((d.userRawId && m.raw_id === d.userRawId) || (d.clientMsgId && (m.clientMsgId || m.client_msg_id) === d.clientMsgId)))
      const nextUser = user < 0 ? -1 : messages.value.findIndex((m, i) => i > user && m.role === 'user')
      const anchor = messages.value.findIndex(m => m.id === d.messageId)
      messages.value.splice(nextUser >= 0 ? nextUser : anchor < 0 ? messages.value.length : anchor + 1, 0, gm)
      gm = messages.value.find(m => m.genId === d.taskId)
    }
    if (d.event === 'generate_progress') { gm.genStatus = 'generating'; gm.genProgress = d.progress; gm.genTotalSteps = d.totalSteps }
    if (d.event === 'generate_retrying') gm.genStatus = 'retrying'
    if (d.event === 'generate_done') { gm.genStatus = 'done'; gm.images = d.images; dialogueRevision.value++ }
    if (d.event === 'generate_error') { gm.genStatus = 'error'; gm.genError = d.error }
  }
  onEvent('private_chat_image', applyImageEvent)
  onEvent('private_chat_aux', d => {
    if (Number(d.characterId) !== Number(activeCharId.value)) return
    const user = [...messages.value].reverse().find(m => m.role === 'user')
    if (!d.clientMsgId || (user?.clientMsgId || user?.client_msg_id) !== d.clientMsgId) return
    if (d.event === 'guesses') { guesses.value = { a: d.a, b: d.b }; guessSourceRawId.value = d.source_raw_id }
    if (d.event === 'affinity_update') { realtimeAffinity.value = d; affinityKey.value++ }
  })
  onEvent('connected', () => {
    if (streaming.value) restoreAfterStream = true
    else if (activeCharId.value) loadMessages(activeCharId.value)
  })

  // 客户端渲染窗口：messages 已全量加载，窗口策略统一由 useMessageWindow 提供
  const { visibleMessages, hasMoreOlder, expandOlder, resetToLatest, anchorToLatest, keepTailPinned } =
    useMessageWindow(messages)

  async function loadCharacters() {
    try { const d = await api.listCharacters(); characters.value = d.characters || [] } catch {}
    sortCharactersByPin()
  }

  // 置顶优先 + 最近消息时间降序（置顶组内部仍按消息时间排）
  function sortCharactersByPin() {
    characters.value.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1
      if (!a.pinned && b.pinned) return 1
      if (!a.last_message_at && !b.last_message_at) return 0
      if (!a.last_message_at) return 1
      if (!b.last_message_at) return -1
      return new Date(b.last_message_at) - new Date(a.last_message_at)
    })
  }

  async function loadMessages(charId) {
    const request = ++historySeq
    const revision = imageRevision
    try {
      const d = await api.getMessages(charId);
      if (request !== historySeq || activeCharId.value !== charId) return false;
      if (revision !== imageRevision) return loadMessages(charId)
      if (!Array.isArray(d.messages)) return false;
      const raw = d.messages || [];
      const result = rawToMessages(raw);
      messages.value = result;
      for (const task of d.imageTasks || []) applyImageEvent({ characterId: charId, taskId: task.id,
        messageId: task.message_id, userRawId: task.user_raw_id, created_at: task.created_at,
        event: task.status === 'failed' ? 'generate_error' : 'generate_start', error: task.error_message })
      anchorToLatest();
      // 恢复好感度快照（切角色后 reatimeAffinity 被清空，从 DB 恢复）
      if (d.affinity && !realtimeAffinity.value) {
        realtimeAffinity.value = {
          affinity: d.affinity.value,
          affinityDelta: d.affinity.delta ?? 0,
          lastReason: d.affinity.reason || '',
        }
      }
      return true;
    } catch { return false }
  }

  // 将服务端原始消息转为前端统一格式
  function rawToMessages(raw) {
    const result = [];
    let genSeq = 0;
    for (const msg of raw) {
      const content = msg.content?.replace(/<br\s*\/?>/gi, '').trim();
      let allImages = [];
      try { allImages = JSON.parse(msg.images || '[]'); } catch {}
      const imageUrls = Array.isArray(allImages) ? allImages : [];
      const emojiImages = imageUrls.filter(isEmojiImageUrl);
      const genImages = imageUrls.filter(u => !isEmojiImageUrl(u));
      if (!content && emojiImages.length === 0 && genImages.length === 0) continue;

      if (msg.raw_id === null && msg.event_id != null) {
        let eventData = null;
        try { eventData = JSON.parse(msg.content); } catch {}
        result.push({
          ...msg,
          content: msg.content,
          type: 'event_card',
          eventId: msg.event_id,
          eventData,
        });
        continue;
      }

      // 空文本消息只是图片载体，不渲染文本气泡。
      const isImageCarrier = !content && emojiImages.length === 0 && genImages.length > 0;
      if (!isImageCarrier) {
        result.push({
          ...msg,
          content,
          type: msg.type || 'text',
          speech_message_id: msg.id,
          sticker_images: emojiImages.map(url => ({ url, base64: null })),
        });
      }
      if (msg.role === 'assistant' && genImages.length > 0) {
        result.push({
          id: uid(),
          role: 'assistant',
          type: 'image_gen',
          genId: `hist_${msg.id}_${genSeq++}`,
          sourceMsgId: msg.id,
          genStatus: 'done',
          images: genImages.map(url => ({ url, base64: null })),
          created_at: msg.created_at,
        });
      }
      }
      return result;
  }

  // 向上展开渲染窗口（无需网络请求，数据已全量在内存中）
  function expandWindow() {
    expandOlder()
  }

  // 后台图片编辑任务确认覆盖后，刷新消息里的图片 URL（避免浏览器缓存旧图）
  function bumpImageUrls(base, newUrl) {
    for (const msg of messages.value) {
      if (msg.type !== 'image_gen' || !Array.isArray(msg.images)) continue
      for (const img of msg.images) {
        const imgUrl = typeof img === 'string' ? img : img?.url
        if (imgUrl && imgUrl.replace(/\?.*$/, '') === base) {
          if (typeof img === 'string') msg.images[msg.images.indexOf(img)] = newUrl
          else img.url = newUrl
        }
      }
    }
  }

  async function selectChar(charId) {
    const selection = ++selectionSeq
    if (activeStream) {
      cancelActiveStream()
      streaming.value = false
      streamingContent.value = ''
      showTypingDots.value = false
    }
    activeCharId.value = charId
    messages.value = []
    resetToLatest()
    guesses.value = null  // 切角色时清除候选词
    guessSourceRawId.value = null
    responseComplete.value = false
    lastSendError.value = ''
    realtimeAffinity.value = null  // 切角色时清除实时好感度
    // 标记主动消息已读（DB 持久化），Sidebar 的 onCharClick 也会调，这里兜底
    try {
      useProactiveStore().markRead(charId)
    } catch { /* 非关键 */ }
    if (selection !== selectionSeq) return false
    affinityKey.value = 0         // 重置动画 key，避免切角色触发 roll
    const loaded = await loadMessages(charId)
    if (selection !== selectionSeq) return false
    await loadCharacters()
    return loaded && selection === selectionSeq
  }

  async function updateActiveCharacter(data) {
    const id = activeCharId.value
    if (!id) return
    await api.updateCharacter(id, data)
    await loadCharacters()
  }

  async function clearActiveMessages() {
    const id = activeCharId.value
    if (!id) return
    cancelActiveStream()
    streaming.value = false
    streamingContent.value = ''
    showTypingDots.value = false
    await api.clearMessages(id)
    messages.value = []
    resetToLatest()
  }

  // 撤回上一轮对话（用户最后一条消息 + 之后的所有 assistant 消息）
  async function undoLastRound() {
    const id = activeCharId.value
    if (!id) return
    const result = await api.undoLastRound(id)
    if (!result.ok || !result.deleted) return

    // 找到本地消息数组中最后一个 user 消息的 raw_id
    const msgs = messages.value
    let lastUserIdx = -1
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === 'user') {
        lastUserIdx = i
        break
      }
    }

    let lastUserRawId = null
    let tailRawId = null

    if (lastUserIdx === -1) {
      // 没有 user 消息（纯主动聊天等），后端已删最后一条 agent raw
      const lastMsg = msgs[msgs.length - 1]
      tailRawId = lastMsg?.raw_id ?? null
    } else {
      lastUserRawId = msgs[lastUserIdx].raw_id ?? null
    }

    // raw_id 缺失时（旧数据、跨版本等），最安全的方式是重新加载
    if ((lastUserIdx >= 0 && lastUserRawId == null) || (lastUserIdx === -1 && tailRawId == null && msgs.length > 0)) {
      await loadMessages(id)
      return
    }

    if (lastUserIdx === -1) {
      // 纯主动聊天：只移除末尾相同 raw_id 的消息
      if (tailRawId != null) {
        messages.value = msgs.filter(m => m.raw_id !== tailRawId)
      }
    } else {
      // 正常路径：移除 raw_id >= lastUserRawId 的所有消息
      messages.value = msgs.filter(m => {
        if (m.raw_id != null) return m.raw_id < lastUserRawId
        const idx = msgs.indexOf(m)
        return idx < lastUserIdx
      })
    }

    // 调整渲染窗口
    keepTailPinned()
  }

  // 在设置页面调用：AI 生成角色并直接入库
  async function generateCharacter(description) {
    const result = await api.generateCharacter(description)
    await loadCharacters()
    return result
  }

  async function uploadAvatar(base64) {
    const id = activeCharId.value
    if (!id) return
    const before = characters.value.find(c => c.id === id)?.avatar_path || ''
    const r = await api.uploadAvatar(id, base64 || '')
    await loadCharacters()
    const after = characters.value.find(c => c.id === id)?.avatar_path || ''
    // P1：只有版本确实变化且保存成功才反馈；移除头像（after 为空）静默
    emitCharacterAvatarChanged({ characterId: id, previousVersion: before, nextVersion: after, ok: true })
    return r
  }

  async function getRecentChatImages() {
    const id = activeCharId.value
    if (!id) return { images: [] }
    return api.getRecentImages(id)
  }

  async function deleteActiveCharacter() {
    const id = activeCharId.value
    const char = characters.value.find(c => c.id === id)
    if (!id || char?.name === 'default') return
    cancelActiveStream()
    streaming.value = false
    streamingContent.value = ''
    showTypingDots.value = false
    await api.deleteCharacter(id)
    messages.value = []
    resetToLatest()
    activeCharId.value = null
    await loadCharacters()
  }

  function findGenMsg(genId) { return messages.value.find(m => m.genId === genId) }

  async function sendMessage(content, imageMode = 'smart', { townContext, galgameMode = false } = {}) {
    if (streaming.value || !content.trim()) return
    const charId = activeCharId.value
    if (!charId) return

    const sessionId = ++streamSeq
    let abort = () => {}
    activeStream = { charId, id: sessionId, abort: () => abort() }

    guesses.value = null  // 用户主动发送 → 清除候选词
    guessSourceRawId.value = null
    responseComplete.value = false
    lastSendError.value = ''
    const now = new Date().toISOString()
    // 幂等键：防止重试导致服务端写入重复用户消息
    const clientMsgId = Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8)
    messages.value.push({ id: uid(), role: 'user', type: 'text', content, created_at: now, clientMsgId })

    streaming.value = true; streamingContent.value = ''; showTypingDots.value = true; memoryRecalling.value = false

    // ── 安全超时：自适应时长，防止 streaming 永久锁死发送键 ──
    //     纯文本场景 30s，生图场景延长到 600s（匹配 ComfyUI 后端超时）
    const TEXT_SAFETY_MS = 30_000
    const IMAGE_SAFETY_MS = 600_000
    let safetyFired = false
    let safetyTimer = null
    let safetyMs = TEXT_SAFETY_MS

    function clearSafetyTimer() {
      if (safetyTimer) { clearTimeout(safetyTimer); safetyTimer = null }
    }
    function resetSafetyTimer(newMs) {
      clearSafetyTimer()
      if (newMs) safetyMs = newMs
      safetyTimer = setTimeout(onSafetyFire, safetyMs)
    }
    function onSafetyFire() {
      if (!isCurrentStream(sessionId)) return
      if (!streaming.value) return
      // 检查是否有正在进行的生图任务
      const hasActiveGen = messages.value.some(m => !m.independentTask && m.type === 'image_gen' && m.genStatus !== 'done' && m.genStatus !== 'error')
      if (hasActiveGen && safetyMs < IMAGE_SAFETY_MS) {
        // 生图还在跑，自动升级到生图级超时
        console.warn('[chat] safety timer: active image gen detected, extending to 600s')
        resetSafetyTimer(IMAGE_SAFETY_MS)
        return
      }
      console.warn('[chat] streaming safety timeout — force reset')
      safetyFired = true
      lastSendError.value = '等待回应超时，请稍后重试'
      abort()
      streaming.value = false
      streamingContent.value = ''
      // 清理当前重试窗口中的空泡
      for (let i = messages.value.length - 1; i >= 0; i--) {
        const m = messages.value[i]
        if (m.role === 'assistant' && m.type === 'text' && !m.content?.trim()) {
          messages.value.splice(i, 1)
        }
      }
      // 标记未完成的生图
      for (let i = messages.value.length - 1; i >= 0; i--) {
        const gm = messages.value[i]
        if (!gm.independentTask && gm.type === 'image_gen' && gm.genStatus !== 'done' && gm.genStatus !== 'error') {
          gm.genStatus = 'error'
        }
      }
      // 确保至少有一条提示
      messages.value.push({
        id: uid(), role: 'assistant', type: 'text',
        content: '(请求超时，请重试)', created_at: new Date().toISOString()
      })
    }
    resetSafetyTimer(TEXT_SAFETY_MS)

    // 安全剥离 {"prompt":"..."} JSON 块
    function stripPromptBlock(s) {
      let t = s.replace(/\{"prompt"\s*:\s*"[^"]*"\}/gi, '')
      const idx = t.indexOf('{"prompt"')
      if (idx !== -1) t = t.slice(0, idx)
      t = t.replace(/<\/?context>/gi, '').replace(/<needImage>/gi, '').replace(/<br\s*\/?>/gi, '')
      return t.replace(/\n{3,}/g, '\n\n').trim()
    }

    // ── 流中断静默重试：最多 2 次额外尝试（共 3 次）──
    //    重试条件：没有收到任何完整气泡（bubble_break）或服务端已保存（msg_saved）
    //    这比 "收到任何 token" 更严格 —— 防止只收到几个残字就不重试的问题
    const MAX_STREAM_RETRIES = 2
    let fullResponse = ''
    let sawImageGen = false  // 本轮是否出现过生图任务（图即回复时禁止 "..." 兜底）
    let admissionError = null

    for (let streamAttempt = 0; streamAttempt <= MAX_STREAM_RETRIES; streamAttempt++) {
      if (!isCurrentStream(sessionId)) break
      if (safetyFired) break
      let thisAttemptHadBubble = false      // 收到完整气泡（bubble_break）
      let thisAttemptHadMsgSaved = false    // 服务端已保存消息（msg_saved assistant）

      // 重试日志
      if (streamAttempt > 0) {
        console.warn(`[chat] stream retry ${streamAttempt}/${MAX_STREAM_RETRIES}...`)
      }

      // ── 每轮尝试的状态 ──
      let bubbleIds, bubbleText, msgSavedIdx, lastEvent, _bufTimer, pendingStickerTimers, pendingTextTimers
      function initAttemptState() {
        const firstBubbleId = uid()
        bubbleIds = [firstBubbleId]
        bubbleText = ''
        msgSavedIdx = 0
        lastEvent = null
        _bufTimer = null
        pendingStickerTimers = new Map()
        pendingTextTimers = new Map()
        messages.value.push({ id: firstBubbleId, role: 'assistant', type: 'text', content: '', created_at: new Date().toISOString() })
      }
      initAttemptState()

      const scheduleSticker = (target, urls, leadingSticker = false) => {
        if (!target || !Array.isArray(urls) || urls.length === 0) return
        const existing = pendingStickerTimers.get(target)
        if (existing) clearTimeout(existing)
        const delay = leadingSticker ? 0 : 450
        pendingStickerTimers.set(target, setTimeout(() => {
          pendingStickerTimers.delete(target)
          target.sticker_images = urls.map(url => ({ url, base64: null }))
        }, delay))
      }
      const scheduleLeadingText = (target, text, delay = 450) => {
        if (!target) return
        const existing = pendingTextTimers.get(target)
        if (existing) clearTimeout(existing)
        pendingTextTimers.set(target, setTimeout(() => {
          pendingTextTimers.delete(target)
          target.content = stripPromptBlock(text)
        }, delay))
      }
      const clearPendingEmojiTimers = () => {
        for (const timer of pendingStickerTimers.values()) clearTimeout(timer)
        for (const timer of pendingTextTimers.values()) clearTimeout(timer)
        pendingStickerTimers.clear()
        pendingTextTimers.clear()
      }

      const { stream, abort: streamAbort } = api.chatStream(charId, content, clientMsgId, imageMode, townContext, galgameMode)
      abort = streamAbort
      const reader = stream.getReader()

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (!isCurrentStream(sessionId)) break
          if (value?.type === 'event') lastEvent = value.event
          if (value?.type === 'data') {
            const d = value.data
            if (lastEvent === 'response_end') { responseComplete.value = true; settleTurnImages(clientMsgId) }
            if (lastEvent === 'dialogue_saved') { responseComplete.value = true; lastSendError.value = ''; dialogueRevision.value++ }
            if (lastEvent === 'error') lastSendError.value = d.message || '回应失败，请稍后重试'
             //  token（只有 token 事件才写入回复气泡，避免 msg_saved 等带 content 的事件串入）
             if (lastEvent === 'token' && (d.content || (Array.isArray(d.images) && d.images.length))) {
               if (showTypingDots.value) showTypingDots.value = false
               if (d.content) {
                 fullResponse += d.content
                 bubbleText += d.content
               }
               const curId = bubbleIds[bubbleIds.length - 1]
               let m = messages.value.find(x => x.id === curId)
               if (!m) {
                 m = { id: curId, role: 'assistant', type: 'text', content: '', created_at: new Date().toISOString() }
                 messages.value.push(m)
               }
                const hasImages = Array.isArray(d.images) && d.images.length
                const leadingSticker = hasImages && !!d.leadingSticker
                if (d.content) {
                  if (leadingSticker) scheduleLeadingText(m, bubbleText)
                  else m.content = bubbleText
                }
                if (hasImages) {
                  scheduleSticker(m, d.images, leadingSticker)
                }

                if (d.content && !_bufTimer && !leadingSticker) {
                  _bufTimer = setTimeout(() => {
                    _bufTimer = null
                    const nowId = bubbleIds[bubbleIds.length - 1]
                    const dm = messages.value.find(x => x.id === nowId)
                    if (dm) dm.content = stripPromptBlock(bubbleText)
                  }, 300)
                }
             }
            // ── bubble_break ──
            if (lastEvent === 'bubble_break') {
              thisAttemptHadBubble = true
              const prevId = bubbleIds[bubbleIds.length - 1]
              const pm = messages.value.find(x => x.id === prevId)
              if (pm) pm.content = stripPromptBlock(bubbleText)
              bubbleText = ''
              const newId = uid()
              bubbleIds.push(newId)
            }
            // ── context_update ──
            if (lastEvent === 'context_update' && d.content !== undefined && d.content !== null) {
              fullResponse = d.content
               if (_bufTimer) { clearTimeout(_bufTimer); _bufTimer = null }
               clearPendingEmojiTimers()
               const parts = d.content.split(/\n{2,}/).map(s => s.trim()).filter(Boolean)
              for (let i = 0; i < parts.length; i++) {
                if (i < bubbleIds.length) {
                  let m = messages.value.find(x => x.id === bubbleIds[i])
                  if (!m) {
                    m = { id: bubbleIds[i], role: 'assistant', type: 'text', content: parts[i], created_at: new Date().toISOString() }
                    messages.value.push(m)
                  } else {
                    m.content = parts[i]
                  }
                } else {
                  const newId = uid()
                  bubbleIds.push(newId)
                  messages.value.push({ id: newId, role: 'assistant', type: 'text', content: parts[i], created_at: new Date().toISOString() })
                }
              }
              for (let i = bubbleIds.length - 1; i >= parts.length; i--) {
                messages.value = messages.value.filter(x => x.id !== bubbleIds[i])
              }
              bubbleIds.length = parts.length
            }
            // ── @memory 主动回想：状态条 ──
            if (lastEvent === 'memory_recall_start') {
              // Memory v3 阶段二：角色发起主动回想，显示状态条并刷新安全超时
              memoryRecalling.value = true
              resetSafetyTimer(TEXT_SAFETY_MS)
            }
            if (lastEvent === 'memory_recall_end') {
              memoryRecalling.value = false
            }
            // ── 生图事件 ──
            if (lastEvent === 'image_unavailable') lastSendError.value = d.message
            if (lastEvent === 'generate_start') {
              // 生图开始，延长安全超时到 10 分钟（匹配 ComfyUI 后端超时）
              resetSafetyTimer(IMAGE_SAFETY_MS)
              sawImageGen = true
              messages.value.push({
                id: uid(), role: 'assistant', type: 'image_gen',
                genId: d.taskId || uid(), genStatus: 'pending', genStartTime: Date.now(),
                created_at: new Date().toISOString(),
              })
            }
            if (lastEvent === 'generate_progress') {
              const gm = findGenMsg(d.taskId)
              if (gm) {
                gm.genStatus = 'generating'
                if (d.progress !== undefined) gm.genProgress = d.progress
                if (d.totalSteps !== undefined) gm.genTotalSteps = d.totalSteps
              }
            }
            if (lastEvent === 'generate_done') {
              const gm = findGenMsg(d.taskId)
              if (gm && d.images) { gm.images = d.images; gm.genStatus = 'done' }
              dialogueRevision.value++
            }
            if (lastEvent === 'generate_retrying') {
              const gm = findGenMsg(d.taskId)
              if (gm) gm.genStatus = 'retrying'
            }
            if (lastEvent === 'generate_error') {
              const gm = findGenMsg(d.taskId)
              if (gm) { gm.genStatus = 'error'; gm.genError = d.error || '' }
            }
            // ── guesses: 回复候选词 ──
            if (lastEvent === 'guesses' && d.a && d.b) {
              guesses.value = { a: d.a, b: d.b }
              guessSourceRawId.value = d.source_raw_id || null
            }
            // ── queued: 日程系统延迟回复 ──
            if (lastEvent === 'queued') {
              queuedReplies.value[charId] = { currentActivity: d.currentActivity || '', estimatedReplyAt: d.estimatedReplyAt || null }
              // 清理临时气泡（后端已保存用户消息）
              for (const bid of bubbleIds) {
                messages.value = messages.value.filter(x => x.id !== bid)
              }
              streaming.value = false
              showTypingDots.value = false
               if (_bufTimer) { clearTimeout(_bufTimer); _bufTimer = null }
               clearPendingEmojiTimers()
               const delayMins = d.delayMinutes || 0
              const activity = d.currentActivity || '某件事'
              if (delayMins === -1) {
                const est = d.estimatedReplyAt ? new Date(d.estimatedReplyAt) : null
                const timeStr = est ? `${est.getHours()}:${String(est.getMinutes()).padStart(2, '0')}` : '稍后'
                console.log(`[chat] ${activeChar.value?.display_name} is sleeping, reply queued until ~${timeStr}`)
              } else {
                console.log(`[chat] ${activeChar.value?.display_name} is busy (${activity}), reply expected in ${delayMins}min`)
              }
              thisAttemptHadMsgSaved = true  // 标记为成功，防止重试循环
              break  // 跳出 stream read 循环
            }
            // ── affinity_update: 实时好感度（递增 key 触发 roll 动画）──
            if (lastEvent === 'affinity_update' && d.affinity !== undefined) {
              realtimeAffinity.value = {
                affinity: d.affinity,
                affinityDelta: d.affinityDelta ?? 0,
                lastReason: d.lastReason || '',
              }
              affinityKey.value++
            }
             //  msg_saved: 临时 ID  真实 ID / 用户消息解析 
             if (lastEvent === 'msg_saved' && d.role === 'assistant' && d.id && msgSavedIdx < bubbleIds.length) {
               thisAttemptHadMsgSaved = true
               const tempId = bubbleIds[msgSavedIdx]
               const m = messages.value.find(x => x.id === tempId)
               if (m) {
                 m.id = d.id
                 if (d.raw_id != null) m.raw_id = d.raw_id
                 m.speech_message_id = d.id
                 m.speech_auto_token = chatSpeechAutoPlay.mark(`chat:${charId}`, d.id)
                  if (d.content !== undefined) m.content = d.content
                  if (Array.isArray(d.images) && d.images.length && !m.sticker_images?.length && !pendingStickerTimers.has(m)) {
                    scheduleSticker(m, d.images, !!d.leadingSticker)
                  }
               }
               msgSavedIdx++
             }
              if (lastEvent === 'msg_saved' && d.role === 'user' && d.client_msg_id) {
                const m = messages.value.find(x => x.role === 'user' && x.clientMsgId === d.client_msg_id)
                if (m) {
                  if (d.content !== undefined) m.content = d.content
                  if (Array.isArray(d.images) && d.images.length) {
                    scheduleSticker(m, d.images, !!d.leadingSticker)
                  }
               }
             }
          }
        } // end while(true)

        // stream 正常结束（done=true）
        // 有完整气泡或服务端已保存 → 成功
        if (!isCurrentStream(sessionId)) break
        if (thisAttemptHadBubble || thisAttemptHadMsgSaved) break
        // 无意义空流（连接后立即关闭，无数据）→ 可重试
        if (streamAttempt < MAX_STREAM_RETRIES) {
          for (const bid of bubbleIds) {
            messages.value = messages.value.filter(x => x.id !== bid)
          }
          const delay = streamAttempt === 0 ? 1000 : 500
          await new Promise(r => setTimeout(r, delay))
          continue
        }
        // 重试耗尽
        if (!sawImageGen) lastSendError.value ||= '没有收到完整回应，请稍后重试'
        for (const bid of bubbleIds) {
          let m = messages.value.find(x => x.id === bid)
          if (!m) continue  // 延迟创建未触发，无需填充
          if (!m.content && !sawImageGen) m.content = '...'
        }
        break
      } catch (err) {
        if (!isCurrentStream(sessionId)) break
        if (townContext !== undefined && [400, 409].includes(err.status)) {
          admissionError = err
          // The town guard rejects before any chat write. Remove only this rejected optimistic turn.
          messages.value = messages.value.filter(m => m.clientMsgId !== clientMsgId && !bubbleIds.includes(m.id))
          bubbleIds.length = 0
          break
        }
        if (safetyFired) { break }
        if (err.name === 'AbortError') { break }

        console.error(`[chat] stream error (attempt ${streamAttempt + 1}):`, err.message)

        // 有完整气泡或服务端已保存 → 不重试，接受已有内容
        if (thisAttemptHadBubble || thisAttemptHadMsgSaved) {
          lastSendError.value = '连接中断，已保留收到的内容'
          console.warn('[chat] stream interrupted but content already committed, keeping partial content')
          break
        }

        if (streamAttempt < MAX_STREAM_RETRIES) {
          // ── 静默重试：没有任何有价值内容，连接可能在握手/早期阶段断开 ──
          //    清理当前尝试的气泡（包括占位和未具现化），准备下次重试
          for (const bid of bubbleIds) {
            messages.value = messages.value.filter(x => x.id !== bid)
          }
          // 短暂等待让服务端重启完成（递减退避：1s → 0.5s）
          const delay = streamAttempt === 0 ? 1000 : 500
          await new Promise(r => setTimeout(r, delay))
          continue  // 进入下一轮 retry
        }

        // 重试已耗尽，显示错误
        lastSendError.value = err.message || '连接断开，请重试'
        for (const bid of bubbleIds) {
          let m = messages.value.find(x => x.id === bid)
          if (!m) {
            m = { id: bid, role: 'assistant', type: 'text', content: '(连接断开，请重试)', created_at: new Date().toISOString() }
            messages.value.push(m)
          } else if (!m.content) {
            m.content = '(连接断开，请重试)'
          }
        }
        break
      } finally {
        if (_bufTimer) { clearTimeout(_bufTimer) }
        memoryRecalling.value = false
        reader.releaseLock()
        if (!isCurrentStream(sessionId)) {
          clearSafetyTimer()
          // eslint-disable-next-line no-unsafe-finally -- 流已被新会话接管时静默退出是既定语义，不吞异常路径之外的逻辑
          return
        }

        // 判断此次尝试是否将重试（气泡已在 retry 路径中被清理，避免 finally 再次清理/兜底）
        const isRetrying = !safetyFired && !thisAttemptHadBubble && !thisAttemptHadMsgSaved && streamAttempt < MAX_STREAM_RETRIES
        if (!isRetrying && !admissionError) {
          // 从后往前删 trailing 空泡
          for (let i = bubbleIds.length - 1; i >= 0; i--) {
            const m = messages.value.find(x => x.id === bubbleIds[i])
            if (!m) {
              if (i > 0 || bubbleIds.length === 1) bubbleIds.splice(i, 1)
            } else if (!m.content?.trim()) {
              if (i > 0 || bubbleIds.length === 1) {
                messages.value = messages.value.filter(x => x.id !== bubbleIds[i])
                bubbleIds.splice(i, 1)
              }
            } else {
              break
            }
          }
          // 从前删 leading 空泡
          for (let i = 0; i < bubbleIds.length - 1; i++) {
            const m = messages.value.find(x => x.id === bubbleIds[i])
            if (!m) {
              bubbleIds.splice(i, 1)
              i--
            } else if (!m.content?.trim()) {
              messages.value = messages.value.filter(x => x.id !== bubbleIds[i])
              bubbleIds.splice(i, 1)
              i--
            } else {
              break
            }
          }
          // 兜底：完全无回复（图即回复时正文为空是预期，不补 "..."）
          if (!fullResponse && !sawImageGen && bubbleIds.length === 1) {
            const m = messages.value.find(x => x.id === bubbleIds[0])
            if (m && !m.content) m.content = '...'
          }
        }
      }
    } // end retry loop

    clearSafetyTimer()
    if (isCurrentStream(sessionId)) {
      streaming.value = false; streamingContent.value = ''; showTypingDots.value = false
      activeStream = null
      if (restoreAfterStream) { restoreAfterStream = false; await loadMessages(charId) }
      if (!admissionError) await loadCharacters()
    }
    if (admissionError) throw admissionError
  }

  /**
   * 处理 SSE 推送的主动消息
   * - 更新角色列表中该角色的 last_message
   * - 如果是当前活跃角色，直接追加到消息列表
   */
  function handleProactiveMessage(data) {
    const charId = data.character_id

    // 更新角色列表中的预览 + 冒泡到最上面
    const char = characters.value.find(c => c.id === charId)
    if (char) {
      char.last_message = data.content
      char.last_message_at = data.created_at
      // 重排（置顶优先 + 时间降序），让主动发消息的角色冒泡到置顶组内最前
      sortCharactersByPin()
      // 通知 Sidebar 滚动到顶部，用户能直接看到是谁发来的
      sidebarScrollSignal.value++
    }

    // 如果是当前活跃角色，直接追加消息到聊天界面
    if (activeCharId.value === charId && data.msg_id) {
      // 文字问候气泡：按 segments 分句，每个分句一个气泡
      const segments = data.segments?.length ? data.segments : [data.content];
      const msgIds = data.msg_ids?.length ? data.msg_ids : [data.msg_id];
      for (let i = 0; i < segments.length; i++) {
        messages.value.push({
          id: msgIds[i] || (i === 0 ? data.msg_id : uid()),
          speech_message_id: msgIds[i] || (i === 0 ? data.msg_id : null),
          speech_auto_token: chatSpeechAutoPlay.mark(`chat:${charId}`, msgIds[i] || (i === 0 ? data.msg_id : null)),
          role: 'assistant',
          type: 'text',
          content: segments[i],
          created_at: data.created_at,
        });
      }

      // 配图气泡（如果主动消息带有图片）
      if (data.images?.length) {
        // 避免与 rawToMessages 加载时重复：检查最后一个气泡是否已经是同一批图片的 image_gen
        const lastMsg = messages.value[messages.value.length - 1];
        const alreadyHas = lastMsg?.type === 'image_gen' && lastMsg.images?.length === data.images.length
          && lastMsg.images.every((img, i) => img.url === data.images[i]);
        if (!alreadyHas) {
          messages.value.push({
            id: uid(),
            role: 'assistant',
            type: 'image_gen',
            genId: `proactive_${data.raw_id || data.msg_id}_${Date.now()}`,
            genStatus: 'done',
            images: data.images.map(url => ({ url, base64: null })),
            created_at: data.created_at,
          });
        }
      }

      // 奇遇分享卡片气泡（如果有）
      if (data.card_msg_id) {
        messages.value.push({
          id: data.card_msg_id,
          role: 'assistant',
          type: 'event_card',
          eventId: data.event_id,
          eventData: {
            title: data.event_title,
            description: data.event_description,
            image: data.event_image,
            expires_at: data.event_expires_at,
            character_id: data.character_id,
            display_name: data.display_name,
            avatar_path: data.avatar_path,
          },
          content: '',
          created_at: data.created_at,
        })
      }
    }
  }

  function handleDelayedReply(data) {
    const charId = data.character_id
    delete queuedReplies.value[charId]

    // 更新角色列表中的预览 + 排序
    const char = characters.value.find(c => c.id === charId)
    if (char) {
      const firstMsg = data.messages?.[0]
      char.last_message = firstMsg?.content || '(延迟回复)'
      char.last_message_at = data.created_at
      sortCharactersByPin()
      sidebarScrollSignal.value++
    }

    // 如果是当前活跃角色，直接追加到消息列表
    if (activeCharId.value === charId && data.messages?.length) {
      for (const msg of data.messages) {
        messages.value.push({
          id: msg.id || uid(),
          role: 'assistant',
          type: 'text',
          content: msg.content,
          created_at: data.created_at,
          is_delayed_reply: true,
          speech_message_id: msg.id,
          speech_auto_token: chatSpeechAutoPlay.mark(`chat:${charId}`, msg.id),
        })
      }
    }
  }

  return { characters, activeCharId, messages, queuedReplies, visibleMessages, streaming, streamingContent, showTypingDots, memoryRecalling, hasMoreOlder, guesses, guessSourceRawId, dialogueRevision, responseComplete, lastSendError, realtimeAffinity, affinityKey, activeChar, sidebarScrollSignal,
    loadCharacters, loadMessages, expandWindow, selectChar, updateActiveCharacter, clearActiveMessages, undoLastRound, generateCharacter, uploadAvatar, getRecentChatImages, deleteActiveCharacter, sendMessage, handleProactiveMessage, handleDelayedReply, bumpImageUrls }
})
