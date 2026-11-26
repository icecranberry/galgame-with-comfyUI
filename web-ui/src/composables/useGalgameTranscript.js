import { computed, ref, watch, onBeforeUnmount } from 'vue'
import { useSettingsStore } from '../stores/settings.js'
import { getDialogueTranscript } from '../api/index.js'
import { mergeDialogueMessages } from '../utils/galgameDialogue.js'

export function useGalgameTranscript(characterId) {
  const messages = ref([]), loading = ref(false), loadingOlder = ref(false), error = ref('')
  const hasOlder = ref(false), latestId = ref(null), latestRole = ref(null)
  let generation = 0, initialized = false, busy = false, pending = false
  watch(characterId, () => {
    generation++; initialized = false; busy = false; pending = false
    messages.value = []; latestId.value = null; latestRole.value = null
    loading.value = false; loadingOlder.value = false; hasOlder.value = false; error.value = ''
  }, { flush: 'sync' })
  async function refresh() {
    if (!characterId()) return
    if (busy) { pending = true; return }
    busy = true
    const ticket = generation, id = characterId()
    loading.value = !initialized
    try {
      let after = initialized ? messages.value.at(-1)?.id : null
      do {
        let data = await getDialogueTranscript(id, after ? { after, limit: 100, refreshIds: messages.value.slice(-100).map(row => row.id).join(',') } : {})
        if (ticket !== generation) return
        if (after && (!data.latestId || data.latestId < after)) {
          // Undo/clear from another surface: replace the tail with authoritative data.
          data = await getDialogueTranscript(id)
          if (ticket !== generation) return
          initialized = false; messages.value = []; after = null
        }
        messages.value = mergeDialogueMessages(messages.value, [...(data.refreshed || []), ...data.messages])
        latestId.value = data.latestId; latestRole.value = data.latestRole
        if (!initialized) hasOlder.value = data.hasMore
        const forward = Boolean(after)
        initialized = true
        after = forward && data.hasMore ? data.messages.at(-1)?.id : null
      } while (after)
      error.value = ''
    } catch (cause) { if (ticket === generation) error.value = cause.message || '对话读取失败，请重试' }
    finally {
      if (ticket === generation) {
        busy = false; loading.value = false
        if (pending) { pending = false; refresh() }
      }
    }
  }
  async function loadOlder() {
    if (loadingOlder.value || !hasOlder.value) return
    const ticket = generation, before = messages.value[0]?.id
    loadingOlder.value = true
    try {
      const data = await getDialogueTranscript(characterId(), { before })
      if (ticket !== generation) return
      messages.value = mergeDialogueMessages(messages.value, data.messages)
      hasOlder.value = data.hasMore; error.value = ''
    } catch (cause) { if (ticket === generation) error.value = cause.message }
    finally { if (ticket === generation) loadingOlder.value = false }
  }
  onBeforeUnmount(() => { generation++ })
  const settings = useSettingsStore()
  const visibleMessages = computed(() => settings.privateChatNarration ? messages.value : messages.value
    .map(row => row.dialogue_only === undefined ? row : { ...row, content: row.dialogue_only })
    .filter(row => row.dialogue_only !== '' || row.images?.length))
  return { messages: visibleMessages, loading, loadingOlder, error, hasOlder, latestId, latestRole, refresh, loadOlder }
}
