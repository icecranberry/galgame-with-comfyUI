// 小镇 BGM 单例：Audio 实例挂在 module 级，世界页（TownView）挂载时续播、卸载时暂停。
// 播放断点就是 Audio.paused 时保留的 currentTime，只存在内存里——刷新页面自然从头开始。

const BGM_SRC = encodeURI('/Whimsy of the Village.mp3')
const BGM_VOLUME = 0.35

let audio = null
let wantPlaying = false // 当前是否有播放意图（区别于「因为静音/离开页面而暂停」）
let retryBound = false

function ensureAudio() {
  if (!audio) {
    audio = new Audio(BGM_SRC)
    audio.loop = true
    audio.volume = BGM_VOLUME
    audio.preload = 'auto'
  }
  return audio
}

function tryPlay() {
  const a = ensureAudio()
  if (!a.paused) return
  a.play().catch(() => {
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

/** 离开世界页：暂停，currentTime 留在内存里作为下次断点 */
export function pauseTownBgm() {
  wantPlaying = false
  audio?.pause()
}

/** 静音开关：静音即暂停（断点保留），取消静音立即续播 */
export function setTownBgmMuted(muted) {
  if (muted) pauseTownBgm()
  else playTownBgm()
}
