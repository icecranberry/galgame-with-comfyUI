// 小镇 BGM 单例：Audio 实例挂在 module 级，世界页（TownView）挂载时续播、卸载时暂停。
// 播放断点就是 Audio.paused 时保留的 currentTime，只存在内存里——刷新页面自然从头开始。

const BGM_SRC = encodeURI('/Whimsy of the Village.mp3')
const BGM_VOLUME = 0.25
const FADE_IN_MS = 1200
const FADE_OUT_MS = 600

let audio = null
let wantPlaying = false // 当前是否有播放意图（区别于「因为静音/离开页面而暂停」）
let retryBound = false
let fadeFrame = 0

function ensureAudio() {
  if (!audio) {
    audio = new Audio(BGM_SRC)
    audio.loop = true
    audio.volume = 0
    audio.preload = 'auto'
  }
  return audio
}

// 从当前音量出发，所以淡出途中又回到世界页时会接着往回淡入，不会跳音量
function fadeTo(target, ms, onDone) {
  cancelAnimationFrame(fadeFrame)
  const a = ensureAudio()
  const from = a.volume
  const start = performance.now()
  const step = (now) => {
    const t = Math.min(1, (now - start) / ms)
    a.volume = from + (target - from) * t
    if (t < 1) fadeFrame = requestAnimationFrame(step)
    else onDone?.()
  }
  fadeFrame = requestAnimationFrame(step)
}

function tryPlay() {
  const a = ensureAudio()
  if (!a.paused) {
    fadeTo(BGM_VOLUME, FADE_IN_MS)
    return
  }
  a.volume = 0
  a.play().then(() => {
    if (wantPlaying) fadeTo(BGM_VOLUME, FADE_IN_MS)
    else a.pause()
  }).catch(() => {
    // 刷新后直接落进世界页时没有用户手势，自动播放会被拦截：
    // 等用户在页面上任意点一下再补播（仅当仍有播放意图时）。
    if (retryBound) return
    retryBound = true
    document.addEventListener('pointerdown', () => {
      if (wantPlaying) tryPlay()
    })
  })
}

/** 进入世界页：从上次断点继续播放 */
export function playTownBgm() {
  wantPlaying = true
  tryPlay()
}

/** 离开世界页：淡出后暂停，currentTime 留在内存里作为下次断点 */
export function pauseTownBgm() {
  wantPlaying = false
  if (!audio || audio.paused) return
  fadeTo(0, FADE_OUT_MS, () => audio.pause())
}

/** 静音开关：静音即暂停（断点保留），取消静音立即续播 */
export function setTownBgmMuted(muted) {
  if (muted) pauseTownBgm()
  else playTownBgm()
}
