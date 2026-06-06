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
    messages.value.push({ id: uid(), role: 'user', type: 'text', content, created_at: now })

    streaming.value = true; streamingContent.value = ''

    const firstBubbleId = uid()
    const bubbleIds = [firstBubbleId]        // temp IDs, msg_saved replaces them with real IDs
    let bubbleText = ''                       // raw text for current bubble (not yet cleaned)
    let msgSavedIdx = 0
    messages.value.push({ id: firstBubbleId, role: 'assistant', type: 'text', content: '', created_at: now })

    // ── 安全超时：30s 无响应自动复位，防止 streaming 永久锁死发送键 ──
    let safetyFired = false
    let safetyTimer = setTimeout(() => {
      if (streaming.value) {
        console.warn('[chat] streaming safety timeout — force reset')
        safetyFired = true
        abort()
        streaming.value = false
        streamingContent.value = ''
        for (const bid of bubbleIds) {
          const m = messages.value.find(x => x.id === bid)
          if (m && !m.content) m.content = '(请求超时，请重试)'
        }
        // 清理未完成的生图占位
        for (let i = messages.value.length - 1; i >= 0; i--) {
          const gm = messages.value[i]
          if (gm.type === 'image_gen' && gm.genStatus !== 'done' && gm.genStatus !== 'error') {
            gm.genStatus = 'error'
          }
        }
      }
    }, 30000)

    let lastEvent = null; let fullResponse = ''

    // 流式标签过滤：缓冲 300ms 预读，若以 <con 开头则自动剥离 XML 标签
    let _stripTags = false
    let _bufTimer = null
    function cleanDisplay(s) {
      // 1. 移除整块 <prompt>...</prompt>（含内容）
      let t = s.replace(/<prompt>[\s\S]*?<\/prompt>/gi, '')
      // 2. 如果 <prompt> 已开始但尚未闭合，切掉 <prompt> 及之后全部内容
      const idx = t.indexOf('<prompt>')
      if (idx !== -1) t = t.slice(0, idx)
      // 3. 剥离其余展示标签
      t = t.replace(/<\/?context>/gi, '').replace(/<needImage>/gi, '').replace(/<br\s*\/?>/gi, '')
      // 4. 清理多余空白：连续空行压缩为单个换行，首尾去空白
      t = t.replace(/\n{3,}/g, '\n\n').trim()
      return t
    }

    const { stream, abort } = api.chatStream(charId, content)
    const reader = stream.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value?.type === 'event') lastEvent = value.event
        if (value?.type === 'data') {
          const d = value.data
          // ── token ──
          if (d.content) {
            fullResponse += d.content
            bubbleText += d.content
            // 立即写入当前气泡（不等 300ms buffer），确保 typing dots 消失
            const curId = bubbleIds[bubbleIds.length - 1]
            const display = _stripTags ? cleanDisplay(bubbleText) : bubbleText
            const m = messages.value.find(x => x.id === curId)
            if (m) m.content = display

            // 300ms buffer 只用于 _stripTags 修正（检测 <con 开头）
            if (!_bufTimer) {
              _bufTimer = setTimeout(() => {
                _stripTags = fullResponse.startsWith('<con')
                const nowId = bubbleIds[bubbleIds.length - 1]
                const dm = messages.value.find(x => x.id === nowId)
                if (dm) dm.content = _stripTags ? cleanDisplay(bubbleText) : bubbleText
              }, 300)
            }
          }
          // ── bubble_break ──
          if (lastEvent === 'bubble_break') {
            fullResponse += '<br>'
            // flush 最终内容到当前气泡
            const prevId = bubbleIds[bubbleIds.length - 1]
            const pm = messages.value.find(x => x.id === prevId)
            if (pm) pm.content = _stripTags ? cleanDisplay(bubbleText) : bubbleText
            // 开启新气泡（短暂空 → 下个 token 立即填充）
            bubbleText = ''
            const newId = uid()
            bubbleIds.push(newId)
            messages.value.push({ id: newId, role: 'assistant', type: 'text', content: '', created_at: new Date().toISOString() })
          }
          // ── context_update ──
          if (lastEvent === 'context_update' && d.content) {
            fullResponse = d.content; _stripTags = false
            streamingContent.value = d.content
            const curId = bubbleIds[bubbleIds.length - 1]
            const m = messages.value.find(x => x.id === curId)
            if (m) m.content = d.content
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
      }
    } catch (err) {
      if (safetyFired) { /* 超时已处理，忽略后续错误 */ }
      else if (err.name === 'AbortError') { /* 用户主动取消，正常 */ }
      else {
        console.error('[chat] stream error:', err.message)
        for (const bid of bubbleIds) {
          const m = messages.value.find(x => x.id === bid)
          if (m && !m.content) m.content = '(连接断开，请重试)'
        }
      }
    } finally {
      clearTimeout(safetyTimer)
      if (_bufTimer) { clearTimeout(_bufTimer); _bufTimer = null }
      // 清除所有空泡（leading/trailing/consecutive separators 都可能产生）
      // 从后往前删 trailing，从前往后删 leading，确保 bubbleIds 索引稳定
      for (let i = bubbleIds.length - 1; i >= 0; i--) {
        const m = messages.value.find(x => x.id === bubbleIds[i])
        if (m && !m.content?.trim()) {
          // 保留至少一个泡（哪怕空，给错误信息留位置）
          if (i > 0 || bubbleIds.length === 1) {
            messages.value = messages.value.filter(x => x.id !== bubbleIds[i])
            bubbleIds.splice(i, 1)
          }
        } else {
          break  // trailing: 遇到有内容的就停
        }
      }
      // 从前删 leading 空泡
      for (let i = 0; i < bubbleIds.length - 1; i++) {
        const m = messages.value.find(x => x.id === bubbleIds[i])
        if (m && !m.content?.trim()) {
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
      reader.releaseLock()
    }

    streaming.value = false; streamingContent.value = ''
    await loadCharacters()
  }

  return { characters, activeCharId, messages, streaming, streamingContent, hasMoreOlder, loadingOlder, activeChar,
    loadCharacters, loadMessages, loadOlderMessages, selectChar, updateActiveCharacter, clearActiveMessages, generateCharacter, updateAvatarColor, uploadAvatar, getRecentChatImages, deleteActiveCharacter, sendMessage }
})
