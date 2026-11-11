import { onScopeDispose, ref } from 'vue'
import * as api from '../api/index.js'
import { onEvent } from '../stores/unifiedStream.js'

export function usePhotoStudio({ apiClient = api, subscribe = onEvent } = {}) {
  const catalog = ref([]), characters = ref([]), jobs = ref([]), capability = ref(null)
  const revisions = new Map()
  const terminalJobs = new Map()
  let capabilityLoaded = false, disposed = false

  function mergeJob(incoming, requestRevisions, trim = true) {
    if (disposed || !incoming?.id) return
    const current = jobs.value.find(job => job.id === incoming.id) || terminalJobs.get(incoming.id)
    // HTTP started before an SSE update must not overwrite that newer state,
    // including when completion arrives before the submission response.
    if (requestRevisions && (revisions.get(incoming.id) || 0) !== (requestRevisions.get(incoming.id) || 0)) return current
    if (current && current.status !== 'running' && incoming.status === 'running') return current
    if (incoming.status === 'done' || incoming.status === 'failed') terminalJobs.set(incoming.id, incoming)
    const index = jobs.value.findIndex(job => job.id === incoming.id)
    if (index < 0) jobs.value = trim ? [incoming, ...jobs.value].slice(0, 30) : [incoming, ...jobs.value]
    else jobs.value = jobs.value.map(job => job.id === incoming.id ? incoming : job)
    return incoming
  }

  function receive({ job } = {}) {
    if (disposed || !job?.id) return
    revisions.set(job.id, (revisions.get(job.id) || 0) + 1)
    mergeJob(job)
  }

  async function refreshJobs() {
    const before = new Map(revisions)
    const result = await apiClient.getPhotoStudioJobs()
    if (disposed) return
    const rows = result.jobs || []
    for (const job of rows) mergeJob(job, before, false)
    const current = new Map(jobs.value.map(job => [job.id, job]))
    const listed = new Set(rows.map(job => job.id))
    // Keep live arrivals ahead of the server snapshot; older history must never
    // evict a newly completed photo when the initial list response arrives late.
    const live = jobs.value.filter(job => !listed.has(job.id) && (revisions.get(job.id) || 0) !== (before.get(job.id) || 0))
    jobs.value = [...live, ...rows.map(job => current.get(job.id) || terminalJobs.get(job.id)).filter(Boolean)].slice(0, 30)
  }

  const unsubscribers = [
    subscribe('photo_studio_progress', receive),
    subscribe('photo_studio_ready', receive),
    subscribe('connected', () => { void refreshJobs().catch(() => {}) }),
  ]
  onScopeDispose(() => { disposed = true; for (const unsubscribe of unsubscribers) unsubscribe() })

  async function load() {
    const pending = [apiClient.getPhotoStudioCatalog(), apiClient.getPhotoStudioCharacters(), refreshJobs()]
    if (!capabilityLoaded) pending.push(apiClient.getPhotoStudioCapability())
    const results = await Promise.allSettled(pending)
    if (disposed) return
    if (results[0].status === 'fulfilled') catalog.value = results[0].value.poses || []
    if (results[1].status === 'fulfilled') characters.value = results[1].value.characters || []
    if (!capabilityLoaded && results[3]?.status === 'fulfilled') { capability.value = results[3].value; capabilityLoaded = true }
  }

  // Low-frequency recovery only. Normal progress and completion use shared SSE.
  async function poll() {
    const running = jobs.value.find(job => job.status === 'running')
    const before = new Map(revisions)
    try {
      if (running) mergeJob((await apiClient.getPhotoStudioJob(running.id)).job, before)
      else await refreshJobs()
    } catch { /* Reconnection or the next recovery check retries transient errors. */ }
  }

  async function create(payload) {
    const before = new Map(revisions)
    const result = await apiClient.createPhotoStudioJob(payload)
    return mergeJob(result.job, before) || result.job
  }
  return { catalog, characters, jobs, capability, load, poll, create }
}
