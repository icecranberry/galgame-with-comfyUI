// A single owner for all chat, original-sample and synthesis playback.
export function createSpeechPlayback(createAudio = () => new Audio(), onStop = () => {}) {
  let audio = null, reusableAudio = null
  let intent = 0
  function stop() { intent++; if (audio) { audio.pause(); audio.currentTime = 0 }; audio = null; onStop() }
  const current = ticket => ticket === intent
  return {
    stop,
    begin() { stop(); return intent },
    current,
    adopt(element) { if (audio === element) return; stop(); audio = element },
    async play(url, ticket, ended = () => {}) {
      if (!current(ticket)) return false
      // Keep the element that the user has allowed to play (notably on iOS).
      const next = reusableAudio ||= createAudio()
      audio = next
      next.src = url
      next.onended = () => { if (current(ticket) && audio === next) { audio = null; ended() } }
      next.onerror = () => { if (current(ticket) && audio === next) { audio = null; ended(new Error('语音播放失败，请重试')) } }
      try { await next.play() } catch (error) { if (current(ticket) && audio === next) audio = null; throw error }
      if (!current(ticket)) { if (audio !== next) next.pause(); return false }
      return true
    },
  }
}
