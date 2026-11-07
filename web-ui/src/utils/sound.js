let _audioCtx = null
let _lastEncounterAt = -Infinity
let _encounterPlayer = null
const encounterSoundUrl = new URL('../assets/sounds/encounter-discovery.wav', import.meta.url).href

/** 奇遇出现：掠过声接魔法钟音与回响；复用播放器，成批通知不叠响。 */
export async function playEncounterSound() {
  try {
    if (typeof window === 'undefined') return
    const now = Date.now()
    if (now - _lastEncounterAt < 1800) return
    _lastEncounterAt = now
    if (!_encounterPlayer) _encounterPlayer = new Audio(encounterSoundUrl)
    _encounterPlayer.currentTime = 0
    await _encounterPlayer.play()
  } catch { /* 自动播放受限或设备不支持时，不影响奇遇通知。 */ }
}

export function playNotificationSound() {
  try {
    if (!_audioCtx) {
      _audioCtx = new (window.AudioContext || window.webkitAudioContext)()
    }
    const ctx = _audioCtx
    if (ctx.state === 'suspended') ctx.resume()

    const osc1 = ctx.createOscillator()
    const gain1 = ctx.createGain()
    osc1.type = 'sine'
    osc1.frequency.setValueAtTime(523.25, ctx.currentTime)
    gain1.gain.setValueAtTime(0.12, ctx.currentTime)
    gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1)
    osc1.connect(gain1)
    gain1.connect(ctx.destination)
    osc1.start(ctx.currentTime)
    osc1.stop(ctx.currentTime + 0.1)

    const osc2 = ctx.createOscillator()
    const gain2 = ctx.createGain()
    osc2.type = 'sine'
    osc2.frequency.setValueAtTime(659.25, ctx.currentTime + 0.1)
    gain2.gain.setValueAtTime(0.12, ctx.currentTime + 0.1)
    gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2)
    osc2.connect(gain2)
    gain2.connect(ctx.destination)
    osc2.start(ctx.currentTime + 0.1)
    osc2.stop(ctx.currentTime + 0.2)
  } catch {
    // ignore
  }
}
