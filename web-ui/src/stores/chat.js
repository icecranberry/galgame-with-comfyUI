import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import * as api from '../api/index.js'

export const useChatStore = defineStore('chat', () => {
  const conversations = ref([])
  const currentConvId = ref(null)
  const messages = ref([])
  const streaming = ref(false)
  const streamingContent = ref('')
  const currentCharId = ref(null)
  const emotion = ref(null)
  // Image generation state
  const generateStatus = ref(null) // { stage: 'submitting'|'generating'|'downloading'|'done', taskId }
  const generateProgress = ref('')

  const currentConv = computed(() =>
    conversations.value.find(c => c.conversation_id === currentConvId.value)
  )

  async function loadConversations() {
    try {
      const data = await api.listConversations()
      conversations.value = data.conversations || []
    } catch (e) {
      console.error('loadConversations:', e)
    }
  }

  async function loadMessages(convId) {
    try {
      const data = await api.getMessages(convId)
      messages.value = data.messages || []
    } catch (e) {
      console.error('loadMessages:', e)
    }
  }

  async function loadEmotion(convId) {
    try {
      const data = await api.getEmotion(convId, currentCharId.value)
      emotion.value = data
    } catch (e) {
      // emotion may not exist yet
    }
  }

  async function selectConversation(convId) {
    currentConvId.value = convId
    messages.value = []
    emotion.value = null
    generateStatus.value = null
    generateProgress.value = ''
    await Promise.all([loadMessages(convId), loadEmotion(convId)])
  }

  async function newConversation() {
    const { conversation_id } = await api.createConversation()
    await loadConversations()
    await selectConversation(conversation_id)
    return conversation_id
  }

  async function sendMessage(content) {
    if (streaming.value || !content.trim()) return

    let convId = currentConvId.value
    if (!convId) {
      convId = await newConversation()
    }

    // Add user message locally
    messages.value.push({
      id: Date.now(),
      conversation_id: convId,
      role: 'user',
      content,
    })

    streaming.value = true
    streamingContent.value = ''
    generateStatus.value = null
    generateProgress.value = ''

    // Placeholder for AI message
    const aiMsgId = Date.now() + 1
    messages.value.push({
      id: aiMsgId,
      conversation_id: convId,
      role: 'assistant',
      content: '',
      images: [],
      generating: false,
    })

    let lastEvent = null
    let fullResponse = ''

    const { stream, abort } = api.chatStream(convId, content, currentCharId.value)
    const reader = stream.getReader()

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        // Track events
        if (value?.type === 'event') {
          lastEvent = value.event
        }

        if (value?.type === 'data') {
          const d = value.data

          // Text streaming
          if (d.content) {
            fullResponse += d.content
            streamingContent.value = fullResponse
            // Update the AI message content in-place
            const aiMsg = messages.value.find(m => m.id === aiMsgId)
            if (aiMsg) aiMsg.content = fullResponse
          }

          // Context update: replace full tagged content with clean context text
          if (lastEvent === 'context_update' && d.content) {
            fullResponse = d.content
            streamingContent.value = d.content
            const aiMsg = messages.value.find(m => m.id === aiMsgId)
            if (aiMsg) aiMsg.content = d.content
          }

          // Image generation events
          if (lastEvent === 'generate_start') {
            generateStatus.value = { stage: 'submitting', taskId: null, prompt: d.prompt }
            generateProgress.value = '准备生成...'
            const aiMsg = messages.value.find(m => m.id === aiMsgId)
            if (aiMsg) aiMsg.generating = true
          }

          if (lastEvent === 'generate_progress') {
            generateStatus.value = { stage: d.stage, taskId: d.taskId }
            if (d.stage === 'submitting') {
              generateProgress.value = '正在提交...'
            } else if (d.stage === 'generating') {
              generateProgress.value = 'AI 正在绘制中，请稍候...'
            } else if (d.stage === 'done') {
              generateProgress.value = '完成！'
            } else {
              generateProgress.value = ''
            }
          }

          if (lastEvent === 'generate_done') {
            generateStatus.value = { stage: 'done', taskId: d.taskId }
            generateProgress.value = ''
            const aiMsg = messages.value.find(m => m.id === aiMsgId)
            if (aiMsg && d.images) {
              aiMsg.images = d.images
              aiMsg.generating = false
            }
          }

          if (lastEvent === 'generate_error') {
            generateStatus.value = { stage: 'error', taskId: d.taskId, error: d.error }
            generateProgress.value = '生成失败: ' + (d.error || '未知错误')
            const aiMsg = messages.value.find(m => m.id === aiMsgId)
            if (aiMsg) aiMsg.generating = false
          }

          // User/assistant message saved
          if (d.role === 'user') {
            const userMsg = messages.value.find(m => m.role === 'user' && m.id === Date.now())
            if (userMsg) userMsg.id = d.id
          }
        }
      }
    } finally {
      reader.releaseLock()
    }

    streaming.value = false
    streamingContent.value = ''

    // Refresh conversation list and emotion
    await Promise.all([
      loadConversations(),
      loadEmotion(convId),
    ])
  }

  function abortStream() {
    streaming.value = false
    streamingContent.value = ''
  }

  return {
    conversations, currentConvId, messages, streaming, streamingContent,
    currentCharId, emotion, currentConv,
    generateStatus, generateProgress,
    loadConversations, loadMessages, selectConversation, newConversation,
    sendMessage, abortStream,
  }
})
