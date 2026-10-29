// Reserve positions at click time, before network/synthesis responses arrive.
// Preparation can overlap; only the head may play, until its audio ends.
export function createSpeechQueue({ player, onPlaying = () => {}, onBlocked = () => {} }) {
  let entries = [], playing = null, controllingPlayer = false
  function control(action) {
    controllingPlayer = true
    try { return action() } finally { controllingPlayer = false }
  }
  function remove(entry, error) {
    if (!entry.active) return
    entries = entries.filter(item => item !== entry)
    entry.active = false
    if (entry.state === 'blocked') onBlocked(false)
    if (playing === entry) { playing = null; onPlaying(null) }
    entry.onState('idle')
    if (error && error.name !== 'AbortError') entry.onError(error)
    queueMicrotask(pump)
  }
  function pump() {
    const entry = entries[0]
    if (playing || !entry || entry.state !== 'ready') return
    const ticket = control(() => player.begin())
    playing = entry
    entry.state = 'playing'
    entry.onState('playing')
    onPlaying(entry.job)
    player.play(entry.job.audio_url, ticket, error => remove(entry, error))
      .then(played => { if (!played) remove(entry) })
      .catch(error => {
        if (!entry.active || playing !== entry) return
        if (error.name === 'NotAllowedError') {
          playing = null; onPlaying(null)
          entry.state = 'blocked'; entry.onState('blocked'); onBlocked(true)
        } else remove(entry, new Error('浏览器未能播放这条语音，请再次点击重试'))
      })
  }
  function clear(stopPlayer = true) {
    const old = entries
    entries = []
    playing = null
    onPlaying(null)
    onBlocked(false)
    // Invalidate all entries before cancelling requests: late responses must
    // never reclaim a slot or interrupt a new chat/voice preview.
    for (const entry of old) { entry.active = false; entry.onState('idle') }
    if (stopPlayer) control(() => player.stop())
    for (const entry of old) Promise.resolve().then(entry.onCancel).catch(() => {})
  }
  return {
    clear,
    discardJobs(ids) {
      for (const entry of [...entries]) {
        if (!ids.has(entry.job?.id)) continue
        if (playing === entry) control(() => player.stop())
        remove(entry)
      }
    },
    // Called synchronously inside a trusted click/key event; no await before play().
    resume() {
      const entry = entries[0]
      if (entry?.state !== 'blocked') return
      onBlocked(false); entry.state = 'ready'; pump()
    },
    // All non-queue audio (previews/recordings) and page changes use the same
    // player's stop hook. Internal advancement must not clear remaining slots.
    interrupt() { if (!controllingPlayer) clear(false) },
    usesJob(id) { return entries.some(entry => !entry.job || entry.job.id === id) },
    reserve({ onState = () => {}, onError = () => {}, onCancel = () => {} } = {}) {
      const entry = { active: true, state: 'preparing', job: null, onState, onError, onCancel,
        ready(job) {
          if (!entry.active) return
          entry.job = job; entry.state = 'ready'; onState('ready'); pump()
        },
        fail(error) { remove(entry, error) },
        async cancel() {
          if (!entry.active) return
          if (playing === entry) control(() => player.stop())
          remove(entry)
          await onCancel()
        },
      }
      entries.push(entry)
      onState('preparing')
      return entry
    },
  }
}
