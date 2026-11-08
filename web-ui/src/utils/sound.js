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

/** 后台任务专用完成音：柔和的 D–F♯–A 上行钟音，约 0.7 秒。 */
export async function playTaskCompletionSound() {
  try {
    if (typeof window === 'undefined') return
    const AudioContext = window.AudioContext || window.webkitAudioContext
    if (!AudioContext) return
    if (!_audioCtx || _audioCtx.state === 'closed') _audioCtx = new AudioContext()
    const ctx = _audioCtx
    if (ctx.state === 'suspended') await ctx.resume()
    if (ctx.state !== 'running') return
    const t0 = ctx.currentTime
    const notes = [[587.33, 0, 0.28], [739.99, 0.12, 0.30], [880, 0.26, 0.44]]
    for (const [frequency, offset, duration] of notes) {
      const start = t0 + offset
      // 低音量基音叠一层更轻的泛音，保留钟声质感与柔和尾音。
      for (const [multiple, volume] of [[1, 0.075], [2, 0.012]]) {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.setValueAtTime(frequency * multiple, start)
        gain.gain.setValueAtTime(0.0001, start)
        gain.gain.exponentialRampToValueAtTime(volume, start + 0.012)
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration)
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.onended = () => { osc.disconnect(); gain.disconnect() }
        osc.start(start)
        osc.stop(start + duration + 0.02)
      }
    }
  } catch { /* 声音播放失败不影响任务完成。 */ }
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
