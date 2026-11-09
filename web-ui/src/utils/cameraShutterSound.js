/** A single recorded SLR shutter click, without added effects. */
const soundUrl = new URL('../assets/sounds/camera-shutter.wav', import.meta.url).href
let player = null
let playbackVersion = 0

function getPlayer() {
  if (!player) {
    player = new Audio(soundUrl)
    player.preload = 'auto'
  }
  return player
}

/** Unlock playback during the user's shutter gesture, without making a sound yet. */
export function prepareCameraShutterSound() {
  try {
    if (typeof window === 'undefined' || typeof Audio === 'undefined') return
    const audio = getPlayer()
    const version = ++playbackVersion
    audio.volume = 0
    audio.play()?.then(() => {
      if (version === playbackVersion) {
        audio.pause()
        if (audio.readyState > 0) audio.currentTime = 0
      }
    }).catch(() => {})
  } catch { /* Audio availability must not prevent taking a photo. */ }
}

export function playCameraShutterSound() {
  try {
    if (typeof window === 'undefined' || typeof Audio === 'undefined') return
    const audio = getPlayer()
    playbackVersion++
    audio.volume = 0.9
    if (audio.readyState > 0) audio.currentTime = 0
    audio.play()?.catch(() => {})
  } catch { /* Sound is optional; never interrupt a completed photo. */ }
}
