/**
 * 《邻舍日报》翻报音效：用 Web Audio 现场合成，不引入音频文件。
 * 一次翻动 = 三段错开的白噪声：低频闷响撑重量、中频摩擦、高频沙声；
 * 浏览器自动播放策略下可能被挂起，页面在后台不响，失败一律静默。
 */

let audioCtx = null
let lastPlayedAt = 0

/**
 * @param {object} params `{ volume = 0.16 }`
 */
export function playNewspaperFlipSound({ volume = 0.16 } = {}) {
  try {
    if (typeof window === 'undefined') return
    if (typeof document !== 'undefined' && document.hidden) return
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    const now = Date.now()
    if (now - lastPlayedAt < 350) return
    lastPlayedAt = now
    if (!audioCtx) audioCtx = new Ctx()
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {})
    const ctx = audioCtx
    const t0 = ctx.currentTime + 0.01

    // 共用一段白噪声，两段带通「沙」错开叠出翻页感
    const frames = Math.max(1, Math.ceil(ctx.sampleRate * 0.45))
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < frames; i += 1) data[i] = Math.random() * 2 - 1

    const swishes = [
      // 低频层：翻页的闷响主体，给声音重量感
      { at: t0, freq: 620, q: 0.6, dur: 0.36, gain: volume },
      // 中频层：纸页整体摩擦声
      { at: t0 + 0.02, freq: 1500, q: 0.9, dur: 0.30, gain: volume * 0.85 },
      // 高频层：纸边的沙声，稍晚一点、更轻
      { at: t0 + 0.09, freq: 2600, q: 1.2, dur: 0.22, gain: volume * 0.45 },
    ]
    for (const s of swishes) {
      const src = ctx.createBufferSource()
      src.buffer = buffer
      const band = ctx.createBiquadFilter()
      band.type = 'bandpass'
      band.frequency.value = s.freq
      band.Q.value = s.q
      const gain = ctx.createGain()
      gain.gain.setValueAtTime(0.0001, s.at)
      gain.gain.exponentialRampToValueAtTime(Math.max(s.gain, 0.0002), s.at + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, s.at + s.dur)
      src.connect(band)
      band.connect(gain)
      gain.connect(ctx.destination)
      src.start(s.at)
      src.stop(s.at + s.dur + 0.02)
    }
  } catch { /* 静默：音效只是点缀，失败不影响日报打开 */ }
}