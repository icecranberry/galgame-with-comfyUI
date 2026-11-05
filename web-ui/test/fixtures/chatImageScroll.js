import { createApp, ref, nextTick } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'
import ChatView from '../../src/views/ChatView.vue'
import { useChatStore } from '../../src/stores/chat.js'
import { useSettingsStore } from '../../src/stores/settings.js'
import '../../src/styles/tokens.css'
import '../../src/styles/base.css'

const pinia = createPinia()
const chat = useChatStore(pinia)
chat.characters = [{ id: 987654, display_name: '滚动测试' }]
chat.activeCharId = 987654
chat.loadCharacters = async () => {}
useSettingsStore(pinia).loadComfyConfig = async () => {}
chat.messages = Array.from({ length: 35 }, (_, i) => ({ id: i + 1, role: i % 2 ? 'user' : 'assistant', type: 'text', content: '已有消息，用于验证图片出现时的平滑跟随。', created_at: '2026-11-05T10:00:00Z' }))
const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/chat/:id', component: ChatView }] })
const app = createApp(ChatView).use(pinia).use(router)
  .provide('isMobile', ref(window.innerWidth < 768)).provide('toast', () => {})
  .provide('confirm', async () => false).provide('toggleMobileSidebar', () => {})
await router.push('/chat/987654')
app.mount('#app')
window.chatScrollFixture = {
  chat,
  async pending(beforeLast = false, progress = 0) {
    const id = 1000 + chat.messages.length
    chat.messages.splice(beforeLast ? chat.messages.length - 1 : chat.messages.length, 0,
      { id, genId: id, role: 'assistant', type: 'image_gen', genStatus: progress ? 'generating' : 'pending', genProgress: progress, created_at: '2026-11-05T10:01:00Z' })
    await nextTick()
  },
  done(url) { Object.assign(chat.messages.findLast(msg => msg.type === 'image_gen'), { genStatus: 'done', images: [{ url }] }) },
  async controlledTurn() {
    const originalFetch = window.fetch
    let textController, imageController, clientMsgId
    window.fetch = (url, options = {}) => {
      const path = String(url)
      if (!path.endsWith('/chat') && !path.endsWith('/stream')) return originalFetch(url, options)
      return Promise.resolve(new Response(new ReadableStream({ start(controller) {
        if (path.endsWith('/chat')) { textController = controller; clientMsgId = JSON.parse(options.body).client_msg_id }
        else imageController = controller
        options.signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')), { once: true })
      } }), { headers: { 'Content-Type': 'text/event-stream' } }))
    }
    const { startUnifiedStream } = await import('../../src/stores/unifiedStream.js')
    startUnifiedStream()
    const done = chat.sendMessage('测试文字与独立图片并行推送')
    const write = (controller, event, data) => controller.enqueue(new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
    window.chatScrollFixture.textEvent = (event, data = {}) => write(textController, event, data)
    window.chatScrollFixture.imageEvent = (event, data = {}) => write(imageController, 'private_chat_image', {
      event, characterId: 987654, clientMsgId, taskId: 8888, messageId: 8889, ...data,
    })
    window.chatScrollFixture.endTurn = async () => {
      write(textController, 'response_end', {}); write(textController, 'dialogue_saved', {})
      textController.close()
      await done
    }
  },
}
