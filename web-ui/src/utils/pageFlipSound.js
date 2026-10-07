/** 日报与日记共用的纸张翻动音效。复用播放器，快速翻阅时不叠加音量。 */
const soundUrl = new URL('../assets/sounds/page-flip.wav', import.meta.url).href
let player = null
let lastPlayedAt = -Infinity
let playbackVersion = 0

function getPlayer() {
  if (!player) {
    player = new Audio(soundUrl)
    player.preload = 'auto'
  }
  return player
}

/** 点击时静音解锁，等日记请求确认有内容后再发声。 */
export function preparePageFlipSound() {
  try {
    if (typeof window === 'undefined' || typeof Audio === 'undefined') return
    if (typeof document !== 'undefined' && document.hidden) return
    const audio = getPlayer()
    const version = ++playbackVersion
    audio.volume = 0
    audio.play()?.then(() => {
      if (version === playbackVersion) audio.pause()
    }).catch(() => {})
  } catch { /* 音频不可用时不阻塞打开日记。 */ }
}

export function playPageFlipSound({ volume = 0.45 } = {}) {
  try {
    if (typeof window === 'undefined' || typeof Audio === 'undefined') return
    if (typeof document !== 'undefined' && document.hidden) return
    const now = Date.now()
    if (now - lastPlayedAt < 120) return
    getPlayer()
    playbackVersion++
    player.volume = Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 0.45
    // 首次加载尚无媒体元数据时，不 seek（部分移动浏览器会抛错，导致首次打开无声）。
    if (player.readyState > 0) player.currentTime = 0
    lastPlayedAt = now
    // 在用户交互中直接 play，兼容移动端播放限制；播放失败不影响阅读。
    player.play()?.catch(() => {})
  } catch { /* 音效只是点缀，设备不支持时静默跳过。 */ }
}
