import { computed, ref, watch, onScopeDispose } from 'vue'
import { useChatStore } from '../../stores/chat.js'

/** A view onto the normal chat store, not a second conversation or SSE client. */
export function useTownCharacterChat(characterId, { chat = useChatStore(), settings, townContext, serviceBusy, onContextInvalid } = {}) {
  const loading = ref(false), error = ref(''), ready = ref(false)
  const contextRejected = ref(false), draftRestore = ref(null), errorCode = ref(null)
  let generation = 0, disposed = false
  const ownsSelection = computed(() => chat.activeCharId === characterId.value)
  const otherReply = computed(() => chat.streaming && !ownsSelection.value)
  const sending = computed(() => ownsSelection.value && chat.streaming)
  const blocked = computed(() => !ready.value || !ownsSelection.value || otherReply.value || contextRejected.value || !townContext?.value || serviceBusy?.value)
  const messages = computed(() => ownsSelection.value ? chat.visibleMessages : [])
  const character = computed(() => chat.characters.find(c => c.id === characterId.value))
  const queued = computed(() => chat.queuedReplies[characterId.value])
  const status = computed(() => serviceBusy?.value ? '正在提供工坊服务，请稍后再交谈。' : !townContext?.value ? '当前小镇身份尚未就绪，请关闭后重新选择邻居。' : otherReply.value ? '另一位邻居正在回应，结束后即可开始交谈。'
    : queued.value ? `${queued.value.currentActivity ? `正在${queued.value.currentActivity}，` : ''}稍后会回复你，消息仍保存在原聊天记录中。` : '')

  async function load() {
    const current = ++generation, id = characterId.value
    ready.value = false
    if (!contextRejected.value) error.value = ''
    if (!id || otherReply.value) { loading.value = false; return }
    // Closing/reopening the same stage must not abort or replace an active reply.
    if (ownsSelection.value && chat.streaming) { ready.value = true; loading.value = false; return }
    loading.value = true
    try {
      const ok = ownsSelection.value ? await chat.loadMessages(id) : await chat.selectChar(id)
      if (disposed || current !== generation) return
      if (ok === false || !ownsSelection.value) throw new Error('History unavailable')
      ready.value = true
    } catch {
      if (current === generation && !disposed) error.value = '暂时无法读取聊天记录，请重新读取后再发送。'
    } finally {
      if (current === generation && !disposed) loading.value = false
    }
  }
  async function send(text) {
    if (blocked.value || loading.value || sending.value || !text.trim()) return
    const current = generation
    try {
      // Same user settings, idempotency key, retry/parser, image and delayed-reply pipeline as ChatView.
      await chat.sendMessage(text, settings?.imageGenMode ?? 'smart', settings?.deepThinkMode ?? false, { townContext: { ...townContext.value } })
    } catch (err) {
      if (current !== generation || disposed) return
      if ([400, 409].includes(err.status)) {
        errorCode.value = err.code
        contextRejected.value = true
        draftRestore.value = { text }
        error.value = `${err.message}。请关闭对话后重新选择邻居。`
        onContextInvalid?.(err)
      } else error.value = '未能确认回复，请重新读取原聊天记录。'
    }
  }
  watch(characterId, () => {
    contextRejected.value = false; errorCode.value = null; draftRestore.value = null
    load()
  }, { immediate: true })
  watch(otherReply, (busy, wasBusy) => { if (wasBusy && !busy && !disposed) load() })
  onScopeDispose(() => { disposed = true; generation++ })
  return { loading, error, errorCode, draftRestore, blocked, sending, messages, character, status, load, send,
    hasMoreOlder: computed(() => ownsSelection.value && chat.hasMoreOlder),
    loadOlder: () => { if (ownsSelection.value) chat.expandWindow() },
  }
}
