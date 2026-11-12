import { computed, effectScope, onScopeDispose, ref, watch } from 'vue'

const controllers = new WeakMap()
const read = (key, fallback) => { try { return JSON.parse(sessionStorage.getItem(key) || 'null') ?? fallback } catch { return fallback } }
const write = (key, value) => { try { sessionStorage.setItem(key, JSON.stringify(value)) } catch { /* Keep the current app session usable without storage. */ } }
const copy = value => JSON.parse(JSON.stringify(value))

export function createPhotoStudioBurst(studio, { prepareSound = () => {}, playSound = () => {} } = {}) {
  if (controllers.has(studio)) return controllers.get(studio)
  const scope = effectScope(true)
  const controller = scope.run(() => {
    const savedIds = read('photo-studio-group', [])
    const groupIds = ref(Array.isArray(savedIds) ? savedIds.filter(id => typeof id === 'string').slice(0, 10) : [])
    const groupIndex = ref(0), burstRunning = ref(false), burstTotal = ref(0), shooting = ref(false), exposure = ref(0), lastFailure = ref('')
    const selectedJobId = ref((() => { try { return sessionStorage.getItem('photo-studio-job') || '' } catch { return '' } })())
    const completed = ref(new Map()), pendingSounds = new Set()
    const groupPhotos = computed(() => groupIds.value.map(id => studio.jobs.value.find(job => job.id === id && job.status === 'done' && job.output_url) || completed.value.get(id)).filter(Boolean))
    let remaining = 0, waitingId = '', timer, recoveryTimer, provider, snapshot, previousIds = [], disposed = false
    watch(groupIds, ids => write('photo-studio-group', ids))
    watch(() => groupPhotos.value.map(job => job.id).join('|'), () => { groupIndex.value = Math.max(0, groupPhotos.value.length - 1) })

    function syncRecovery() {
      if (!disposed && (burstRunning.value || shooting.value || pendingSounds.size || studio.jobs.value.some(job => job.status === 'running'))) {
        recoveryTimer ||= setInterval(() => { void studio.poll() }, 15000)
      } else {
        clearInterval(recoveryTimer)
        recoveryTimer = undefined
      }
    }
    function stop() {
      clearTimeout(timer)
      timer = undefined
      remaining = 0
      waitingId = ''
      provider = null
      burstRunning.value = false
      syncRecovery()
    }
    function fail(message) {
      lastFailure.value = message || '拍摄失败，请重试'
      if (!groupPhotos.value.length) groupIds.value = previousIds
      stop()
    }
    function detachInput(input) {
      // Capture the latest ordinary shutter input while its page is still alive.
      if (provider !== input) return
      snapshot = copy(input())
      provider = null
    }
    async function submit() {
      if (disposed || !burstRunning.value) return
      if (studio.jobs.value.some(job => job.status === 'running')) {
        timer = setTimeout(submit, 800)
        return
      }
      shooting.value = true
      lastFailure.value = ''
      exposure.value++
      let id
      try {
        snapshot = copy(provider ? provider() : snapshot)
        id = crypto.randomUUID()
        waitingId = id
        remaining--
        pendingSounds.add(id)
        groupIds.value = [...groupIds.value, id]
        // Always call the single-shot endpoint. Never reuse a polished result or
        // resolved random character in place of the original shutter parameters.
        const job = await studio.create({ ...copy(snapshot), id })
        if (!disposed) {
          selectedJobId.value = job.id
          try { sessionStorage.setItem('photo-studio-job', job.id) } catch { /* Session-only selection still works. */ }
        }
      } catch (error) {
        pendingSounds.delete(id)
        if (!disposed) fail(error.message)
      } finally {
        shooting.value = false
        // Single shots keep their existing lifecycle; a burst stays stoppable
        // through its final print, until the terminal job update arrives.
        if (!remaining && burstTotal.value === 1) stop()
        syncRecovery()
      }
    }
    function start(count, input) {
      if (disposed || burstRunning.value || shooting.value || studio.jobs.value.some(job => job.status === 'running')) return
      snapshot = copy(input())
      provider = input
      previousIds = [...groupIds.value]
      completed.value = new Map(groupPhotos.value.map(job => [job.id, job]))
      groupIds.value = []
      groupIndex.value = 0
      burstTotal.value = Math.max(1, Math.min(10, Math.round(Number(count) || 1)))
      remaining = burstTotal.value
      burstRunning.value = true
      prepareSound()
      syncRecovery()
      return submit()
    }
    watch([studio.jobs, shooting], () => {
      let sounded = false
      for (const job of studio.jobs.value) {
        if (job.status !== 'done' && job.status !== 'failed') continue
        if (groupIds.value.includes(job.id) && job.status === 'done' && job.output_url) completed.value.set(job.id, job)
        const tracked = pendingSounds.delete(job.id)
        if (tracked && job.status === 'done') sounded = true
        if (tracked && job.status === 'failed') fail(job.error)
      }
      if (sounded) playSound()
      syncRecovery()
      // SSE can complete before the POST response; both must finish first.
      if (disposed || !burstRunning.value || shooting.value || !waitingId) return
      const job = studio.jobs.value.find(item => item.id === waitingId)
      if (!job || job.status === 'running') return
      waitingId = ''
      if (job.status !== 'done') { fail(job.error); return }
      if (!remaining) { stop(); return }
      timer = setTimeout(() => { timer = undefined; void submit() }, 800)
    })
    onScopeDispose(() => { disposed = true; stop(); clearInterval(recoveryTimer); pendingSounds.clear() })
    return { groupIds, groupIndex, groupPhotos, burstRunning, burstTotal, shooting, exposure, lastFailure, selectedJobId, start, stop, detachInput }
  })
  controller.dispose = () => { scope.stop(); controllers.delete(studio) }
  controllers.set(studio, controller)
  return controller
}
