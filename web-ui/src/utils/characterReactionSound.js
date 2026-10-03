/**
 * 角色通知提示音：用 Web Audio 现场合成一声极轻的「叮」，不引入音频文件。
 * 浏览器自动播放策略下可能被挂起，失败一律静默；同一时刻只响一次。
 */

let audioCtx = null
let lastPlayedAt = 0

/**
 * @param {object} params `{ enabled = true, volume = 0.045 }`
 */
export function playReactionSound({ enabled = true, volume = 0.045 } = {}) {
  if (!enabled) return
  try {
    if (typeof window === 'undefined') return
    if (typeof document !== 'undefined' && document.hidden) return
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    const now = Date.now()
    if (now - lastPlayedAt < 150) return
    lastPlayedAt = now
    if (!audioCtx) audioCtx = new Ctx()
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {})
    const t0 = audioCtx.currentTime
    // 两个很短的音：先低后高，音量快速衰减，整体很轻
    const notes = [[784, t0, 0.09], [1046.5, t0 + 0.055, 0.10]]
    for (const [freq, start, dur] of notes) {
      const osc = audioCtx.createOscillator()
      const gain = audioCtx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, start)
      gain.gain.exponentialRampToValueAtTime(volume, start + 0.012)
      gain.gain.exponentialRampToValueAtTime(0.0001, start + dur)
      osc.connect(gain)
      gain.connect(audioCtx.destination)
      osc.start(start)
      osc.stop(start + dur + 0.02)
    }
  } catch { /* 静默：声音只是点缀，失败不影响通知 */ }
}