// Keep the creation response even after cancellation: it contains the server
// job ID needed to cancel work that was already accepted by the backend.
export function createSpeechTask({ request, wait, cancel, onJob = () => {} }) {
  const controller = new AbortController()
  let job, cancelled = false, cancellation
  const abortError = () => new DOMException('已取消语音', 'AbortError')
  function cancelJob() {
    if (!job || !['queued', 'generating'].includes(job.status)) return
    return cancellation ||= Promise.resolve(cancel(job)).then(result => { if (result) onJob(result) })
  }
  return {
    get cancelled() { return cancelled },
    async cancel() {
      cancelled = true
      controller.abort()
      await cancelJob()
    },
    async run() {
      try { job = await request(controller.signal) }
      catch (error) { if (cancelled) throw abortError(); throw error }
      onJob(job)
      if (cancelled) { await cancelJob(); throw abortError() }
      const result = await wait(job, controller.signal)
      if (cancelled) throw abortError()
      return result
    },
  }
}
