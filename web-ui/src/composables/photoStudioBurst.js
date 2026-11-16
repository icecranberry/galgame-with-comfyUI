import { computed, effectScope, onScopeDispose, ref, watch } from 'vue'

const controllers = new WeakMap()
const read = (key, fallback) => { try { return JSON.parse(sessionStorage.getItem(key) || 'null') ?? fallback } catch { return fallback } }
const write = (key, value) => { try { sessionStorage.setItem(key, JSON.stringify(value)) } catch { /* The server remains authoritative. */ } }

// This controller only follows the server batch and plays local presentation.
// It never schedules the next shot, including after an animation resolves.
export function createPhotoStudioBurst(studio, { prepareSound = () => {}, playSound = () => {} } = {}) {
  if (controllers.has(studio)) return controllers.get(studio)
  const scope = effectScope(true)
  const controller = scope.run(() => {
    const savedIds = read('photo-studio-group', [])
    const groupIds = ref(Array.isArray(savedIds) ? savedIds.filter(id => typeof id === 'string').slice(0, 10) : [])
    const groupIndex = ref(0), shooting = ref(false), exposure = ref(0), presenting = ref(false), lastFailure = ref(''), stopPending = ref(false)
    const selectedJobId = ref((() => { try { return sessionStorage.getItem('photo-studio-job') || '' } catch { return '' } })())
    const completed = ref(new Map()), pendingShots = new Set(), seen = new Set()
    const burstRunning = computed(() => ['running', 'stopping'].includes(studio.batch.value?.status))
    const burstTotal = computed(() => studio.batch.value?.total || 0)
    const stopping = computed(() => stopPending.value || studio.batch.value?.status === 'stopping')
    const groupPhotos = computed(() => groupIds.value.map(id => studio.jobs.value.find(job => job.id === id && job.status === 'done' && job.output_url) || completed.value.get(id)).filter(Boolean))
    let recoveryTimer, presenter, presentingId = '', requestedId = '', initiatedId = '', observedId = '', disposed = false
    const presentationQueue = []
    watch(groupIds, ids => write('photo-studio-group', ids))
    watch(selectedJobId, id => { try { sessionStorage.setItem('photo-studio-job', id) } catch { /* Server state restores the selection. */ } })
    watch(() => groupPhotos.value.map(job => job.id).join('|'), () => { groupIndex.value = Math.max(0, groupPhotos.value.length - 1) })

    function attachPresentation(callback) {
      presenter = callback
      return () => { if (presenter === callback) presenter = null }
    }
    function isPendingPresentation(id) { return pendingShots.has(id) || presentingId === id }
    async function drainPresentation() {
      if (!presentationQueue.length || presenting.value || disposed) return
      presenting.value = true
      try {
        while (presentationQueue.length && !disposed) {
          const job = presentationQueue.shift()
          presentingId = job.id
          let sounded = false
          const sound = () => { if (!sounded && !disposed && job.batch_id === initiatedId) { sounded = true; playSound() } }
          try {
            if (presenter) await presenter(job, sound)
            else sound()
          } catch (error) { console.warn('[photoStudio] 成片揭晓失败：', error.message) }
          finally { pendingShots.delete(job.id); presentingId = '' }
        }
      } finally { presenting.value = false }
    }
    watch(studio.batch, batch => {
      if (!batch) return
      const changed = observedId !== batch.id
      if (changed) {
        observedId = batch.id
        seen.clear()
        pendingShots.clear()
        presentationQueue.length = 0
        completed.value = new Map()
        // Reload/reconnect restores completed photos without replaying them.
        if (requestedId !== batch.id) for (const job of batch.jobs || []) if (job.status !== 'running') seen.add(job.id)
      }
      for (const job of batch.jobs || []) {
        if (!seen.has(job.id)) pendingShots.add(job.id)
        if (job.status === 'done' && job.output_url) completed.value.set(job.id, job)
      }
      groupIds.value = batch.job_ids
      selectedJobId.value = batch.current_job_id || batch.jobs?.at(-1)?.id || ''
      if (batch.status === 'failed') lastFailure.value = batch.error || '拍摄失败，已停止后续连拍'
      else if (changed) lastFailure.value = ''
    }, { immediate: true, flush: 'sync' })

    watch(studio.jobs, () => {
      for (const job of studio.jobs.value) {
        if (!groupIds.value.includes(job.id)) continue
        if (job.status === 'running') { if (!seen.has(job.id)) pendingShots.add(job.id); continue }
        // sessionStorage can restore old group IDs before the batch snapshot
        // arrives (or for legacy photos without a batch). Only reveal a shot
        // tracked as pending in this session, or submitted by this controller.
        const shouldReveal = pendingShots.has(job.id) || job.batch_id === initiatedId
        if (!seen.has(job.id) && shouldReveal && job.status === 'done' && job.output_url) pendingShots.add(job.id)
        if (job.status === 'done' && job.output_url) completed.value.set(job.id, job)
        if (seen.has(job.id)) continue
        seen.add(job.id)
        if (shouldReveal && job.status === 'done' && job.output_url) {
          pendingShots.add(job.id)
          presentationQueue.push(job)
        } else { pendingShots.delete(job.id) }
      }
      void drainPresentation()
    }, { flush: 'sync' })
    watch([burstRunning, shooting, studio.jobs], () => {
      if (!disposed && (burstRunning.value || shooting.value || studio.jobs.value.some(job => job.status === 'running'))) {
        recoveryTimer ||= setInterval(() => { void studio.poll() }, 15000)
      } else { clearInterval(recoveryTimer); recoveryTimer = undefined }
    }, { immediate: true })

    async function start(count, input) {
      if (disposed || burstRunning.value || shooting.value || studio.jobs.value.some(job => job.status === 'running')) return
      shooting.value = true
      lastFailure.value = ''
      requestedId = crypto.randomUUID()
      initiatedId = requestedId
      prepareSound()
      exposure.value++
      try {
        await studio.createBatch({ id: requestedId, count: Math.max(1, Math.min(10, Math.round(Number(count) || 1))), input: JSON.parse(JSON.stringify(input())) })
      } catch (error) { if (!disposed) lastFailure.value = error.message }
      finally { shooting.value = false; requestedId = '' }
    }
    async function stop() {
      if (!burstRunning.value || stopping.value) return
      stopPending.value = true
      try { await studio.stopBatch(studio.batch.value.id) }
      catch (error) {
        lastFailure.value = `未能确认停止：${error.message}`
        void studio.poll()
      } finally { stopPending.value = false }
    }
    onScopeDispose(() => {
      disposed = true
      clearInterval(recoveryTimer)
      pendingShots.clear()
      presentationQueue.length = 0
      // Closing a page/controller must never send a stop request.
    })
    return { groupIds, groupIndex, groupPhotos, burstRunning, burstTotal, shooting, exposure, presenting, stopping, lastFailure, selectedJobId, start, stop, attachPresentation, isPendingPresentation }
  })
  controller.dispose = () => { scope.stop(); controllers.delete(studio) }
  controllers.set(studio, controller)
  return controller
}
