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
      result.push({ ...msg, type: msg.type || 'text' });
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

  function findGenMsg(genId) { return messages.value.find(m => m.genId === genId) }

  async function sendMessage(content) {
    if (streaming.value || !content.trim()) return
    const charId = activeCharId.value
    if (!charId) return

    const now = new Date().toISOString()
    messages.value.push({ id: uid(), role: 'user', type: 'text', content, created_at: now })

    streaming.value = true; streamingContent.value = ''

    const aiMsgId = uid()
    messages.value.push({ id: aiMsgId, role: 'assistant', type: 'text', content: '', created_at: now })

    // ── 安全超时：30s 无响应自动复位，防止 streaming 永久锁死发送键 ──
    let safetyFired = false
    let safetyTimer = setTimeout(() => {
      if (streaming.value) {
        console.warn('[chat] streaming safety timeout — force reset')
        safetyFired = true
        abort()
        streaming.value = false
        streamingContent.value = ''
        const m = messages.value.find(x => x.id === aiMsgId)
        if (m && !m.content) m.content = '(请求超时，请重试)'
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
    let _showDirect = false
    let _stripTags = false
    let _bufTimer = null
    function cleanDisplay(s) {
      // 1. 移除整块 <prompt>...</prompt>（含内容）
      let t = s.replace(/<prompt>[\s\S]*?<\/prompt>/gi, '')
      // 2. 如果 <prompt> 已开始但尚未闭合，切掉 <prompt> 及之后全部内容
      const idx = t.indexOf('<prompt>')
      if (idx !== -1) t = t.slice(0, idx)
      // 3. 剥离其余展示标签
      t = t.replace(/<\/?context>/gi, '').replace(/<needImage>/gi, '')
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
          // ── 内容输出 ──
          if (d.content) {
            fullResponse += d.content
            if (_showDirect) {
              const display = _stripTags ? cleanDisplay(fullResponse) : fullResponse
              streamingContent.value = display
              const m = messages.value.find(x => x.id === aiMsgId)
              if (m) m.content = display
            } else if (!_bufTimer) {
              _bufTimer = setTimeout(() => {
                _showDirect = true
                _stripTags = fullResponse.startsWith('<con')
                const display = _stripTags ? cleanDisplay(fullResponse) : fullResponse
                streamingContent.value = display
                const m = messages.value.find(x => x.id === aiMsgId)
                if (m) m.content = display
              }, 300)
            }
          }
          if (lastEvent === 'context_update' && d.content) {
            fullResponse = d.content; _showDirect = true; _stripTags = false
            streamingContent.value = d.content
            const m = messages.value.find(x => x.id === aiMsgId)
            if (m) m.content = d.content
          }
          if (lastEvent === 'generate_start') {
            const genTime = Date.now()
            messages.value.push({
              id: uid(), role: 'assistant', type: 'image_gen',
              genId: d.taskId || uid(), genStatus: 'pending', genStartTime: genTime,
              created_at: new Date().toISOString(),
            })
          }
          if (lastEvent === 'generate_progress') {
            const gm = findGenMsg(d.taskId)
            if (gm) gm.genStatus = 'generating'
          }
          if (lastEvent === 'generate_done') {
            const gm = findGenMsg(d.taskId)
            if (gm && d.images) {
              gm.images = d.images
              gm.genStatus = 'done'
            }
          }
          if (lastEvent === 'generate_error') {
            const gm = findGenMsg(d.taskId)
            if (gm) gm.genStatus = 'error'
          }
        }
      }
    } catch (err) {
      if (safetyFired) { /* 超时已处理，忽略后续错误 */ }
      else if (err.name === 'AbortError') { /* 用户主动取消，正常 */ }
      else {
        console.error('[chat] stream error:', err.message)
        const m = messages.value.find(x => x.id === aiMsgId)
        if (m && !m.content) m.content = '(连接断开，请重试)'
      }
    } finally {
      clearTimeout(safetyTimer)
      if (_bufTimer) { clearTimeout(_bufTimer); _bufTimer = null }
      // ── 防御性 flush：若响应在 300ms 缓冲内就结束了，_showDirect 仍为 false ──
      // fullResponse 已有完整内容但从未写入消息，导致空气泡。补写一次。
      if (!_showDirect && fullResponse) {
        const display = fullResponse
        const m = messages.value.find(x => x.id === aiMsgId)
        if (m) m.content = display
      }
      reader.releaseLock()
    }

    streaming.value = false; streamingContent.value = ''
    await loadCharacters()
  }

  return { characters, activeCharId, messages, streaming, streamingContent, hasMoreOlder, loadingOlder, activeChar,
    loadCharacters, loadMessages, loadOlderMessages, selectChar, updateActiveCharacter, clearActiveMessages, generateCharacter, sendMessage }
})
