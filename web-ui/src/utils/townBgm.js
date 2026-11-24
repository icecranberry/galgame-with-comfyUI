// 小镇 BGM 单例：Audio 实例挂在 module 级，世界页（TownView）挂载时续播、卸载时暂停。
// 播放断点就是 Audio.paused 时保留的 currentTime，只存在内存里——刷新页面自然从头开始。

const BGM_SRC = encodeURI('/Whimsy of the Village.mp3')
const BGM_VOLUME = 0.25
const FADE_IN_MS = 1200
const FADE_OUT_MS = 600

let audio = null
let ctx = null
let gain = null
let pendingPlay = null
let pauseTimer = null

// 音量走 Web Audio 的 GainNode：渐变在音频线程上执行，世界页加载卡住主线程时也不会一跳一跳
function ensureAudio() {
  if (!audio) {
    audio = new Audio(BGM_SRC)
    audio.loop = true
    audio.preload = 'auto'
    ctx = new AudioContext()
    gain = ctx.createGain()
    gain.gain.value = 0
    ctx.createMediaElementSource(audio).connect(gain).connect(ctx.destination)
  }
  return audio
}

// 从当前音量出发，所以淡出途中又回到世界页时会接着往回淡入，不会跳音量
function fadeTo(target, ms) {
  const now = ctx.currentTime
  const param = gain.gain
  param.cancelScheduledValues(now)
  param.setValueAtTime(param.value, now)
  param.linearRampToValueAtTime(target, now + ms / 1000)
}

function retryPlayback(event) {
  if (event.isTrusted && navigator.userActivation?.isActive !== false) tryPlay()
}

function setPlaybackRetry(enabled) {
  // 触屏的 click 在用户激活之后触发，首次 pointerdown 还不能解锁音频。
  for (const type of ['click', 'keydown']) {
    if (enabled) document.addEventListener(type, retryPlayback, true)
    else document.removeEventListener(type, retryPlayback, true)
  }
}

function tryPlay() {
  const a = ensureAudio()
  if (pauseTimer !== null) {
    clearTimeout(pauseTimer)
    pauseTimer = null
    fadeTo(BGM_VOLUME, FADE_IN_MS)
  }
  if (pendingPlay || !a.paused) {
    if (ctx.state !== 'running') ctx.resume().catch(() => {})
    return
  }

  setPlaybackRetry(true)
  // play() 等待音频数据期间 paused 已经为 false，等音频和音频上下文都就绪再淡入。
  const attempt = Promise.all([ctx.resume(), a.play()])
  pendingPlay = attempt
  attempt.then(() => {
    if (pendingPlay !== attempt) return
    pendingPlay = null
    setPlaybackRetry(false)
    fadeTo(BGM_VOLUME, FADE_IN_MS)
  }, () => {
    if (pendingPlay !== attempt) return
    pendingPlay = null
    a.pause()
  })
}

/** 进入世界页：从上次断点继续播放 */
export function playTownBgm() {
  tryPlay()
}

/** 离开世界页：淡出后暂停，currentTime 留在内存里作为下次断点 */
export function pauseTownBgm() {
  setPlaybackRetry(false)
  if (pendingPlay) {
    pendingPlay = null
    audio.pause()
    return
  }
  if (!audio || audio.paused || pauseTimer !== null) return
  fadeTo(0, FADE_OUT_MS)
  pauseTimer = setTimeout(() => {
    pauseTimer = null
    audio.pause()
  }, FADE_OUT_MS)
}

/** 静音开关：静音后淡出暂停，取消静音时淡入续播 */
export function setTownBgmMuted(muted) {
  if (muted) pauseTownBgm()
  else playTownBgm()
}
