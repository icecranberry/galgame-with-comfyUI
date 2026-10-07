import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { gravityOffset } from '../utils/standingGravity.js'

let nextNativeSession = 0

export function useStandingGravity({ excluded, suspended, touching }) {
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  const touchQuery = window.matchMedia('(any-pointer: coarse)')
  const reduced = ref(motionQuery.matches)
  const mobile = ref(touchQuery.matches && navigator.maxTouchPoints > 0)
  const bridge = window.AndroidBridge
  let native = false
  try {
    native = typeof bridge?.startStandingGravity === 'function' &&
      typeof bridge?.stopStandingGravity === 'function' && bridge.hasStandingGravity() === true
  } catch { /* Older APKs keep the browser path. */ }
  const available = computed(() => !excluded && (native || (mobile.value && window.isSecureContext && typeof window.DeviceOrientationEvent !== 'undefined')))
  const needsPermission = !native && typeof window.DeviceOrientationEvent?.requestPermission === 'function'
  const permission = ref(needsPermission ? 'prompt' : 'granted')
  const status = ref('idle'), offset = ref({ x: 0, y: 0 }), active = ref(false)
  const requesting = ref(false)
  const nativePaused = ref(false)
  let nativeSession = null, screenAngle = null
  let baseline = null, target = { x: 0, y: 0 }, frame = 0, timeout = 0, listening = false, disposed = false, lastTime = 0
  const style = computed(() => ({ transform: `translate3d(${offset.value.x}px, ${offset.value.y}px, 0)` }))
  const canRun = computed(() => available.value && !reduced.value && !suspended.value && !nativePaused.value && permission.value === 'granted')

  function animate(time) {
    frame = 0
    const factor = 1 - Math.exp(-Math.min(64, time - (lastTime || time - 16)) / 90)
    lastTime = time
    if (!touching.value) {
      const current = offset.value
      const next = { x: current.x + (target.x - current.x) * factor, y: current.y + (target.y - current.y) * factor }
      const settled = Math.abs(next.x - target.x) + Math.abs(next.y - target.y) < 0.01
      offset.value = settled ? { ...target } : next
      if (!settled) frame = requestAnimationFrame(animate)
    }
  }
  function schedule() { if (!frame) { lastTime = 0; frame = requestAnimationFrame(animate) } }
  function sample(event) {
    if (!listening || disposed || !canRun.value) return
    if (!Number.isFinite(event.beta) || !Number.isFinite(event.gamma)) return
    clearTimeout(timeout)
    status.value = 'active'; active.value = true
    const angle = event.angle ?? window.screen.orientation?.angle ?? window.orientation ?? 0
    if (screenAngle !== angle) { baseline = null; screenAngle = angle }
    baseline ||= { beta: event.beta, gamma: event.gamma }
    target = gravityOffset(event, baseline, angle)
    if (!touching.value) schedule()
  }
  function stop() {
    window.removeEventListener('deviceorientation', sample)
    window.removeEventListener('linshe-gravity', nativeSample)
    if (nativeSession !== null) {
      try { bridge.stopStandingGravity(nativeSession) } catch { /* The activity may be closing. */ }
      nativeSession = null
    }
    listening = false; clearTimeout(timeout); cancelAnimationFrame(frame); frame = 0
    baseline = null; active.value = false; target = { x: 0, y: 0 }
    if (suspended.value || nativePaused.value || reduced.value || disposed) offset.value = { ...target }
    else schedule()
  }
  function start() {
    if (!canRun.value || listening) return
    baseline = null; status.value = 'waiting'; listening = true
    if (native) {
      nativeSession = String(++nextNativeSession)
      window.addEventListener('linshe-gravity', nativeSample)
      try { bridge.startStandingGravity(nativeSession) }
      catch { stop(); status.value = 'unavailable'; return }
    } else window.addEventListener('deviceorientation', sample, { passive: true })
    timeout = window.setTimeout(() => {
      stop(); status.value = 'unavailable'
    }, 4000)
  }
  function nativeSample(event) {
    const data = event.detail
    if (!listening || !data || data.session !== nativeSession) return
    if (data.error) { stop(); status.value = 'unavailable'; return }
    sample(data)
  }
  function nativeLifecycle(event) {
    if (!native || typeof event.detail?.active !== 'boolean') return
    nativePaused.value = !event.detail.active
    // WebView visibilitychange isn't guaranteed for every Activity transition.
    if (event.detail.active) calibrate()
    else stop()
  }
  function calibrate() { stop(); start() }
  async function authorize() {
    if (requesting.value) return
    requesting.value = true
    try {
      const result = await window.DeviceOrientationEvent.requestPermission()
      if (!disposed) permission.value = result === 'granted' ? 'granted' : 'denied'
    } catch { if (!disposed) permission.value = 'denied' }
    finally { requesting.value = false }
  }
  function updateMedia() {
    reduced.value = motionQuery.matches
    mobile.value = touchQuery.matches && navigator.maxTouchPoints > 0
  }
  watch(canRun, value => value ? start() : stop(), { immediate: true })
  watch(touching, value => { if (!value && canRun.value) schedule() })
  motionQuery.addEventListener('change', updateMedia)
  touchQuery.addEventListener('change', updateMedia)
  window.addEventListener('orientationchange', calibrate)
  window.screen.orientation?.addEventListener('change', calibrate)
  if (native) window.addEventListener('linshe-gravity-lifecycle', nativeLifecycle)
  onBeforeUnmount(() => {
    disposed = true; stop()
    motionQuery.removeEventListener('change', updateMedia)
    touchQuery.removeEventListener('change', updateMedia)
    window.removeEventListener('orientationchange', calibrate)
    window.screen.orientation?.removeEventListener('change', calibrate)
    if (native) window.removeEventListener('linshe-gravity-lifecycle', nativeLifecycle)
  })
  return { available, permission, requesting, reduced, status, active, style, authorize }
}
