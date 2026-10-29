// Keep play() on the pointerup / keyboard call stack: awaiting a request first
// loses user activation on mobile browsers. Metadata is loaded with touch lines.
export function createStandingTouchSpeech(player) {
  let ticket = null
  let playing = null

  function stop() {
    if (ticket !== null && player.current(ticket)) player.stop()
    ticket = null
    playing = null
  }

  function reconcile(speech) {
    if (!playing) return
    const line = speech?.enabled && speech.configured && speech.lines?.[playing.part]?.find(item =>
      item.text === playing.text && item.audio_url === playing.url)
    if (!line) stop()
  }

  function play(part, text, speech) {
    stop()
    if (!speech?.enabled || !speech.configured) return Promise.resolve(false)
    const line = speech.lines?.[part]?.find(item => item.text === text && item.audio_url)
    if (!line) return Promise.resolve(false)
    const own = player.begin()
    ticket = own
    playing = { part, text, url: line.audio_url }
    // A retained successful URL is still playable while regeneration is pending
    // or failed. The server only returns audio belonging to this exact text.
    return player.play(line.audio_url, own, () => {
      if (ticket === own) { ticket = null; playing = null }
    }).catch(() => {
      // Playback rejection must never disrupt the text reaction or poison the
      // next gesture. A newer audio owner must also remain untouched.
      if (ticket === own) { ticket = null; playing = null }
      return false
    })
  }

  return { play, stop, reconcile }
}
