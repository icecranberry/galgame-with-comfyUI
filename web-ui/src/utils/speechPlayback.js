// A single owner for all chat, original-sample and synthesis playback.
export function createSpeechPlayback(createAudio = () => new Audio(), onStop = () => {}) {
  let audio = null
  let intent = 0
  return {
    stop() { intent++; if (audio) { audio.pause(); audio.currentTime = 0 }; audio = null; onStop() },
    begin() { this.stop(); return intent },
    current(ticket) { return ticket === intent },
    adopt(element) { if (audio === element) return; this.stop(); audio = element },
    async play(url, ticket, ended = () => {}) {
      if (!this.current(ticket)) return false
      const next = createAudio()
      audio = next
      next.src = url
      next.onended = next.onerror = () => { if (audio === next) { audio = null; ended() } }
      try { await next.play() } catch (error) { if (audio === next) audio = null; throw error }
      if (!this.current(ticket)) { next.pause(); return false }
      return true
    },
  }
}
