import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import * as api from '../api/index.js'

let _seq = Date.now()
function uid() { return ++_seq }

export const useChatStore = defineStore('chat', () => {
  const characters = ref([])
  const activeCharId = ref(null)
  const messages = ref([])       // unified: { id, role, type, content, images, genId, genStatus, genStartTime, created_at }
  const streaming = ref(false)
  const streamingContent = ref('')
  const showTypingDots = ref(false)   // 打字动画：仅在发送后、首个 token 到达前显示一次
  const hasMoreOlder = ref(false)   // 是否还有更早的一周可加载
  const loadingOlder = ref(false)   // 正在加载旧消息中
  const activeChar = computed(() => characters.value.find(c => c.id === activeCharId.value))

  async function loadCharacters() {
    try { const d = await api.listCharacters(); characters.value = d.characters || [] } catch {}
  }

  async function loadMessages(charId) {
    try {
      const d = await api.getMessages(charId);
      const raw = d.messages || [];
      const result = rawToMessages(raw);
      messages.value = result;
      hasMoreOlder.value = !!d.hasMore;
    } catch {}
  }

  // 将服务端原始消息转为前端统一格式
  function rawToMessages(raw) {
    const result = [];
    let genSeq = 0;
    for (const msg of raw) {
      // 清除历史消息中残留的 <br> 气泡分割标记，跳过清理后为空的消息
      const content = msg.content?.replace(/<br\s*\/?>/gi, '').trim();
      if (!content) continue;   // 跳过空气泡（buggy 版本遗留的空 DB 记录）
      result.push({ ...msg, content, type: msg.type || 'text' });
      if (msg.role === 'assistant' && msg.images) {
        try {
          const imageUrls = JSON.parse(msg.images);
          if (Array.isArray(imageUrls) && imageUrls.length > 0) {
            result.push({
              id: uid(),
              role: 'assistant',
              type: 'image_gen',
              genId: `hist_${msg.id}_${genSeq++}`,
              genStatus: 'done',
              images: imageUrls.map(url => ({ url, base64: null })),
              created_at: msg.created_at,
            });
          }
        } catch {}
      }
    }
    return result;
  }

  // 加载更早一周的消息（向上翻）
  async function loadOlderMessages() {
    if (!hasMoreOlder.value || loadingOlder.value) return
    const oldest = messages.value[0]
    if (!oldest?.created_at) return
    loadingOlder.value = true
    try {
      const d = await api.getMessages(activeCharId.value, { before: oldest.created_at });
      const raw = d.messages || [];
      if (raw.length > 0) {
        const older = rawToMessages(raw);
        // 去重后拼到现有消息前面
        const existingIds = new Set(messages.value.map(m => m.id));
        const fresh = older.filter(m => !existingIds.has(m.id));
        messages.value = [...fresh, ...messages.value];
      }
      hasMoreOlder.value = !!d.hasMore;
    } catch {} finally {
      loadingOlder.value = false
    }
  }

  async function selectChar(charId) {
    activeCharId.value = charId
    messages.value = []
    await loadMessages(charId)
    await loadCharacters()
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
    await api.clearMessages(id)
    messages.value = []
  }

  // 在设置页面调用：AI 生成角色并直接入库
  async function generateCharacter(description) {
    const result = await api.generateCharacter(description)
    await loadCharacters()
    return result
  }

  async function updateAvatarColor(color) {
    const id = activeCharId.value
    if (!id) return
    await api.updateCharacter(id, { avatar_color: color })
    await loadCharacters()
  }

  async function uploadAvatar(base64) {
    const id = activeCharId.value
    if (!id) return
    const r = await api.uploadAvatar(id, base64 || '')
    await loadCharacters()
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
    await api.deleteCharacter(id)
    messages.value = []
    activeCharId.value = null
    await loadCharacters()
  }

  function findGenMsg(genId) { return messages.value.find(m => m.genId === genId) }

  async function sendMessage(content) {
    if (streaming.value || !content.trim()) return
    const charId = activeCharId.value
    if (!charId) return

    const now = new Date().toISOString()
    // 幂等键：防止重试导致服务端写入重复用户消息
    const clientMsgId = Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8)
    messages.value.push({ id: uid(), role: 'user', type: 'text', content, created_at: now })

    streaming.value = true; streamingContent.value = ''; showTypingDots.value = true

    // ── 安全超时：30s 无响应自动复位，防止 streaming 永久锁死发送键 ──
    let safetyFired = false
    let abort = () => {}
    const safetyTimer = setTimeout(() => {
      if (streaming.value) {
        console.warn('[chat] streaming safety timeout — force reset')
        safetyFired = true
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
          if (gm.type === 'image_gen' && gm.genStatus !== 'done' && gm.genStatus !== 'error') {
            gm.genStatus = 'error'
          }
        }
        // 确保至少有一条提示
        messages.value.push({
          id: uid(), role: 'assistant', type: 'text',
          content: '(请求超时，请重试)', created_at: new Date().toISOString()
        })
      }
    }, 30000)

    // 安全剥离 <prompt> 块 —— 不作为正常显示内容
    function stripPromptBlock(s) {
      let t = s.replace(/<prompt>[\s\S]*?<\/prompt>/gi, '')
      const idx = t.indexOf('<prompt>')
      if (idx !== -1) t = t.slice(0, idx)
      t = t.replace(/<\/?context>/gi, '').replace(/<needImage>/gi, '').replace(/<br\s*\/?>/gi, '')
      return t.replace(/\n{3,}/g, '\n\n').trim()
    }

    // ── 流中断静默重试：最多 2 次额外尝试（共 3 次），仅在没有收到任何 token 时重试 ──
    const MAX_STREAM_RETRIES = 2
    let fullResponse = ''

    for (let streamAttempt = 0; streamAttempt <= MAX_STREAM_RETRIES; streamAttempt++) {
      if (safetyFired) break
      let thisAttemptHadTokens = false

      // 重试日志
      if (streamAttempt > 0) {
        console.warn(`[chat] stream retry ${streamAttempt}/${MAX_STREAM_RETRIES}...`)
      }

      // ── 每轮尝试的状态 ──
      let bubbleIds, bubbleText, msgSavedIdx, lastEvent, _bufTimer
      function initAttemptState() {
        const firstBubbleId = uid()
        bubbleIds = [firstBubbleId]
        bubbleText = ''
        msgSavedIdx = 0
        lastEvent = null
        _bufTimer = null
        messages.value.push({ id: firstBubbleId, role: 'assistant', type: 'text', content: '', created_at: new Date().toISOString() })
      }
      initAttemptState()

      const { stream, abort: streamAbort } = api.chatStream(charId, content, clientMsgId)
      abort = streamAbort
      const reader = stream.getReader()
      let streamSuccess = false

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) { streamSuccess = true; break }
          if (value?.type === 'event') lastEvent = value.event
          if (value?.type === 'data') {
            const d = value.data
            // ── token ──
            if (d.content) {
              if (showTypingDots.value) showTypingDots.value = false
              thisAttemptHadTokens = true
              fullResponse += d.content
              bubbleText += d.content
              const curId = bubbleIds[bubbleIds.length - 1]
              let m = messages.value.find(x => x.id === curId)
              if (!m) {
                m = { id: curId, role: 'assistant', type: 'text', content: '', created_at: new Date().toISOString() }
                messages.value.push(m)
              }
              m.content = bubbleText

              if (!_bufTimer) {
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
              const prevId = bubbleIds[bubbleIds.length - 1]
              const pm = messages.value.find(x => x.id === prevId)
              if (pm) pm.content = stripPromptBlock(bubbleText)
              bubbleText = ''
              const newId = uid()
              bubbleIds.push(newId)
            }
            // ── context_update ──
            if (lastEvent === 'context_update' && d.content) {
              fullResponse = d.content
              if (_bufTimer) { clearTimeout(_bufTimer); _bufTimer = null }
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
            // ── 生图事件 ──
            if (lastEvent === 'generate_start') {
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
            }
            if (lastEvent === 'generate_error') {
              const gm = findGenMsg(d.taskId)
              if (gm) gm.genStatus = 'error'
            }
            // ── msg_saved: 临时 ID → 真实 ID ──
            if (lastEvent === 'msg_saved' && d.role === 'assistant' && d.id && msgSavedIdx < bubbleIds.length) {
              const tempId = bubbleIds[msgSavedIdx]
              const m = messages.value.find(x => x.id === tempId)
              if (m) m.id = d.id
              msgSavedIdx++
            }
          }
        } // end while(true)

        // stream 正常结束
        break
      } catch (err) {
        if (safetyFired) { break }
        if (err.name === 'AbortError') { break }

        console.error(`[chat] stream error (attempt ${streamAttempt + 1}):`, err.message)

        if (!thisAttemptHadTokens && streamAttempt < MAX_STREAM_RETRIES) {
          // ── 静默重试：没有收到任何 token，连接可能在握手阶段断开 ──
          //    清理当前尝试的气泡（包括占位和未具现化），准备下次重试
          for (const bid of bubbleIds) {
            messages.value = messages.value.filter(x => x.id !== bid)
          }
          // 短暂等待让服务端重启完成（递减退避：1s → 0.5s）
          const delay = streamAttempt === 0 ? 1000 : 500
          await new Promise(r => setTimeout(r, delay))
          continue  // 进入下一轮 retry
        }

        // 已经有 token 了，不重试，显示部分内容
        if (thisAttemptHadTokens) {
          console.warn('[chat] stream interrupted after tokens received, keeping partial content')
        } else {
          // 重试已耗尽，显示错误
          for (const bid of bubbleIds) {
            let m = messages.value.find(x => x.id === bid)
            if (!m) {
              m = { id: bid, role: 'assistant', type: 'text', content: '(连接断开，请重试)', created_at: new Date().toISOString() }
              messages.value.push(m)
            } else if (!m.content) {
              m.content = '(连接断开，请重试)'
            }
          }
        }
        break
      } finally {
        if (_bufTimer) { clearTimeout(_bufTimer); _bufTimer = null }
        reader.releaseLock()

        // 如果不是静默重试（streamSuccess || 最终失败），做气泡清理
        const isRetrying = !streamSuccess && !safetyFired && !thisAttemptHadTokens && streamAttempt < MAX_STREAM_RETRIES
        if (!isRetrying) {
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
          // 兜底：完全无回复
          if (!fullResponse && bubbleIds.length === 1) {
            const m = messages.value.find(x => x.id === bubbleIds[0])
            if (m && !m.content) m.content = '(无回复)'
          }
        }
      }
    } // end retry loop

    clearTimeout(safetyTimer)
    streaming.value = false; streamingContent.value = ''; showTypingDots.value = false
    await loadCharacters()
  }

  return { characters, activeCharId, messages, streaming, streamingContent, showTypingDots, hasMoreOlder, loadingOlder, activeChar,
    loadCharacters, loadMessages, loadOlderMessages, selectChar, updateActiveCharacter, clearActiveMessages, generateCharacter, updateAvatarColor, uploadAvatar, getRecentChatImages, deleteActiveCharacter, sendMessage }
})
