import { watch, onBeforeUnmount } from 'vue'
import { speechEnabled, speechAutoPlay, stopSpeech } from '../stores/speech.js'
import { chatSpeechAutoPlay } from '../utils/speechAutoPlay.js'

export function useSpeechAutoPlay(scope) {
  let leave
  watch(scope, value => {
    leave?.()
    stopSpeech()
    leave = chatSpeechAutoPlay.enter(value, () => speechEnabled.value && speechAutoPlay.value && !document.hidden)
  }, { immediate: true, flush: 'sync' })
  watch([speechEnabled, speechAutoPlay], ([enabled, autoPlay]) => {
    if (!enabled || !autoPlay) { chatSpeechAutoPlay.clear(); stopSpeech() }
  }, { flush: 'sync' })
  onBeforeUnmount(() => { if (leave?.()) stopSpeech() })
}
