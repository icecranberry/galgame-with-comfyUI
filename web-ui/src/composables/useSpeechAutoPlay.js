import { watch, onMounted, onBeforeUnmount, inject } from 'vue'
import { speechEnabled, speechAutoPlay, speechPlaybackBlocked, speechQueue, stopSpeech } from '../stores/speech.js'
import { chatSpeechAutoPlay } from '../utils/speechAutoPlay.js'

export function useSpeechAutoPlay(scope) {
  const toast = inject('toast', null)
  const resumePlayback = event => {
    if (event.isTrusted && !document.hidden && (event.type === 'click' || ['Enter', ' '].includes(event.key))) speechQueue.resume()
  }
  watch(speechPlaybackBlocked, blocked => {
    if (blocked) toast?.('浏览器暂停了自动朗读，请点击或轻触页面继续播放', 'warning')
  })
  onMounted(() => {
    document.addEventListener('click', resumePlayback, true)
    document.addEventListener('keydown', resumePlayback, true)
  })
  let leave
  watch(scope, value => {
    leave?.()
    stopSpeech()
    leave = chatSpeechAutoPlay.enter(value, () => speechEnabled.value && speechAutoPlay.value && !document.hidden)
  }, { immediate: true, flush: 'sync' })
  watch([speechEnabled, speechAutoPlay], ([enabled, autoPlay]) => {
    if (!enabled || !autoPlay) { chatSpeechAutoPlay.clear(); stopSpeech() }
  }, { flush: 'sync' })
  onBeforeUnmount(() => {
    document.removeEventListener('click', resumePlayback, true)
    document.removeEventListener('keydown', resumePlayback, true)
    if (leave?.()) stopSpeech()
  })
}
