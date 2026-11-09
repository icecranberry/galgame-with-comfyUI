import { ref } from 'vue'
import * as api from '../api/index.js'

export function usePhotoStudio() {
  const catalog = ref([]), characters = ref([]), jobs = ref([]), capability = ref(null)
  let capabilityLoaded = false
  async function load() {
    const pending = [api.getPhotoStudioCatalog(), api.getPhotoStudioCharacters(), api.getPhotoStudioJobs()]
    if (!capabilityLoaded) pending.push(api.getPhotoStudioCapability())
    const results = await Promise.allSettled(pending)
    if (results[0].status === 'fulfilled') catalog.value = results[0].value.poses || []
    if (results[1].status === 'fulfilled') characters.value = results[1].value.characters || []
    if (results[2].status === 'fulfilled') jobs.value = results[2].value.jobs || []
    if (!capabilityLoaded && results[3]?.status === 'fulfilled') { capability.value = results[3].value; capabilityLoaded = true }
  }
  async function poll() {
    const running = jobs.value.find(job => job.status === 'running')
    if (running) {
      try { const result = await api.getPhotoStudioJob(running.id); jobs.value = [result.job, ...jobs.value.filter(job => job.id !== running.id)] } catch { /* The list refresh will recover transient errors. */ }
    } else await load()
  }
  async function create(payload) { const result = await api.createPhotoStudioJob(payload); jobs.value = [result.job, ...jobs.value.filter(job => job.id !== result.job.id)]; return result.job }
  return { catalog, characters, jobs, capability, load, poll, create }
}
