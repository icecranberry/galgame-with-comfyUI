import { watch, onMounted, onBeforeUnmount, onActivated, onDeactivated, inject } from 'vue'
import { speechEnabled, speechAutoPlay, speechPlaybackBlocked, speechQueue, stopSpeech } from '../stores/speech.js'
import { chatSpeechAutoPlay } from '../utils/speechAutoPlay.js'

export function useSpeechAutoPlay(scope) {
  const toast = inject('toast', null)
  let leave, active = true
  const suspend = () => {
    if (leave?.()) stopSpeech()
    leave = undefined
  }
  const enter = () => {
    suspend()
    if (!active || document.hidden || !scope()) return
    stopSpeech()
    leave = chatSpeechAutoPlay.enter(scope(), () => active && speechEnabled.value && speechAutoPlay.value && !document.hidden)
  }
  const onVisibilityChange = () => document.hidden ? suspend() : enter()
  const resumePlayback = event => {
    if (event.isTrusted && !document.hidden && (event.type === 'click' || ['Enter', ' '].includes(event.key))) speechQueue.resume()
  }
  watch(speechPlaybackBlocked, blocked => {
    if (blocked) toast?.('浏览器暂停了自动朗读，请点击或轻触页面继续播放', 'warning')
  })
  onMounted(() => {
    document.addEventListener('click', resumePlayback, true)
    document.addEventListener('keydown', resumePlayback, true)
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('pagehide', suspend)
    window.addEventListener('pageshow', enter)
  })
  watch(scope, enter, { immediate: true, flush: 'sync' })
  watch([speechEnabled, speechAutoPlay], ([enabled, autoPlay]) => {
    if (!enabled || !autoPlay) { chatSpeechAutoPlay.clear(); stopSpeech() }
  }, { flush: 'sync' })
  onDeactivated(() => { active = false; suspend() })
  onActivated(() => { if (!active) { active = true; enter() } })
  onBeforeUnmount(() => {
    active = false
    document.removeEventListener('click', resumePlayback, true)
    document.removeEventListener('keydown', resumePlayback, true)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('pagehide', suspend)
    window.removeEventListener('pageshow', enter)
    suspend()
  })
}
