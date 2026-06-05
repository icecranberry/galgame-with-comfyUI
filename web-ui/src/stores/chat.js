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
  const activeChar = computed(() => characters.value.find(c => c.id === activeCharId.value))

  async function loadCharacters() {
    try { const d = await api.listCharacters(); characters.value = d.characters || [] } catch {}
  }

  async function loadMessages(charId) {
    try {
      const d = await api.getMessages(charId);
      const raw = d.messages || [];
      // 将服务端消息转为前端统一格式：text 消息直接映射，assistant 文本消息带 images 的在其后插入 image_gen 条目
      const result = [];
      let genSeq = 0;
      for (const msg of raw) {
        result.push({ ...msg, type: msg.type || 'text' });
        // 历史 assistant 消息如果带有 images JSON，在它后面插入已完成的 image_gen
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
      messages.value = result;
    } catch {}
  }

  async function selectChar(charId) {
    activeCharId.value = charId
    messages.value = []
    await loadMessages(charId)
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

    const aiMsgId = uid()
    messages.value.push({ id: aiMsgId, role: 'assistant', type: 'text', content: '', created_at: now })

    let lastEvent = null; let fullResponse = ''

    const { stream } = api.chatStream(charId, content)
    const reader = stream.getReader()
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (value?.type === 'event') lastEvent = value.event
        if (value?.type === 'data') {
          const d = value.data
          if (d.content) {
            fullResponse += d.content; streamingContent.value = fullResponse
            const m = messages.value.find(x => x.id === aiMsgId)
            if (m) m.content = fullResponse
          }
          if (lastEvent === 'context_update' && d.content) {
            fullResponse = d.content; streamingContent.value = d.content
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
      console.error('[chat] stream error:', err.message)
      const m = messages.value.find(x => x.id === aiMsgId)
      if (m && !m.content) m.content = '(连接断开，请重试)'
    } finally { reader.releaseLock() }

    streaming.value = false; streamingContent.value = ''
    await loadCharacters()
  }

  return { characters, activeCharId, messages, streaming, streamingContent, activeChar,
    loadCharacters, loadMessages, selectChar, sendMessage }
})
