import { reactive, ref } from 'vue'
import { onEvent } from './unifiedStream.js'
import { ttsApi } from '../api/tts.js'
import { createSpeechPlayback } from '../utils/speechPlayback.js'
import { createSpeechQueue } from '../utils/speechQueue.js'

export const speechJobs = reactive({})
export const messageSpeech = reactive({})
export const speechEnabled = ref(false)
export const speechAutoPlay = ref(false)
export const playingSpeech = ref(null)
export const speechPlaybackBlocked = ref(false)
export const speechPlayer = createSpeechPlayback(undefined, () => { playingSpeech.value = null; speechQueue.interrupt() })
export const speechQueue = createSpeechQueue({ player: speechPlayer, onPlaying: job => { playingSpeech.value = job?.id || null }, onBlocked: value => { speechPlaybackBlocked.value = value } })
let loadSequence = 0
const clearedJobs = new Set()
onEvent('speech_update', job => { if (job?.id && !clearedJobs.has(job.id)) speechJobs[job.id] = job })
onEvent('speech_cache_cleared', invalidateSpeechCache)
export function invalidateSpeechCache(result) {
  const ids = new Set(result.ids || [])
  if (!ids.size) return
  for (const id of ids) { clearedJobs.add(id); delete speechJobs[id] }
  for (const [messageId, jobId] of Object.entries(messageSpeech)) if (ids.has(jobId)) delete messageSpeech[messageId]
  speechQueue.discardJobs(ids)
}
export function stopSpeech() { speechPlayer.stop(); playingSpeech.value = null }
export async function loadSpeech(characterId, { groupId } = {}) {
  const sequence = ++loadSequence
  const knownJobs = { ...speechJobs }, knownMessages = { ...messageSpeech }
  const settings = await ttsApi('/settings')
  if (sequence !== loadSequence) return
  speechEnabled.value = settings.enabled
  speechAutoPlay.value = settings.auto_play === true
  const history = await ttsApi(groupId ? `/groups/${groupId}/messages` : `/characters/${characterId}/messages`)
  if (sequence !== loadSequence) return
  // 历史快照不得覆盖加载期间收到的 SSE 更新或新一次朗读的消息绑定。
  for (const job of history) {
    if (clearedJobs.has(job.id)) continue
    if (speechJobs[job.id] === knownJobs[job.id]) speechJobs[job.id] = job
    if (messageSpeech[job.message_id] === knownMessages[job.message_id]) messageSpeech[job.message_id] = job.id
  }
}
function assertSpeechCache(job) {
  if (!clearedJobs.has(job.id)) return
  // A creation response may arrive after the cleanup event and rebind its bubble.
  delete speechJobs[job.id]
  for (const [messageId, jobId] of Object.entries(messageSpeech)) if (jobId === job.id) delete messageSpeech[messageId]
  throw new Error('语音缓存已清理，请再次朗读')
}
export async function waitSpeech(job, signal) {
  assertSpeechCache(job)
  speechJobs[job.id] = job
  const deadline = Date.now() + 900000
  while (['queued', 'generating'].includes(job.status)) {
    if (signal?.aborted) throw new DOMException('已停止等待', 'AbortError')
    if (Date.now() > deadline) throw new Error('等待语音超时，可稍后再次点击查询')
    await new Promise((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(new DOMException('已停止等待', 'AbortError')) }
      const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve() }, 1000)
      signal?.addEventListener('abort', abort, { once: true })
    })
    job = await ttsApi(`/jobs/${job.id}`, undefined, 'GET', signal)
    assertSpeechCache(job)
    speechJobs[job.id] = job
  }
  if (job.status !== 'completed') throw new Error(job.error || '语音生成已取消')
  return job
}
