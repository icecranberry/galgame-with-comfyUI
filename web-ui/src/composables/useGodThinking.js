import { ref, watch } from 'vue'

// 展开状态只属于本次页面停留；回复正文到达、工具轮次和本轮完成均不触发折叠。
export function useGodThinking(getSnapshot) {
  const expanded = ref({})
  const currentRunId = ref(null)
  let observing = false
  let sessionId = null
  let knownRuns = new Set()

  function collapseThinking() { expanded.value = {}; currentRunId.value = null }
  function seed() {
    const snapshot = getSnapshot()
    sessionId = snapshot?.session.id ?? null
    knownRuns = new Set(snapshot?.runs.map(run => run.id) || [])
  }
  function activateThinking() { seed(); observing = true }
  function leaveThinking() { observing = false; collapseThinking() }
  function acceptThinking(runId) {
    if (!observing || currentRunId.value === runId) return
    collapseThinking(); currentRunId.value = runId
  }

  watch(() => [getSnapshot()?.session.id, ...(getSnapshot()?.runs.map(run => run.id) || [])], () => {
    const snapshot = getSnapshot()
    if (!observing || (snapshot?.session.id ?? null) !== sessionId) {
      collapseThinking(); seed(); return
    }
    const newest = snapshot?.runs.filter(run => !knownRuns.has(run.id)).at(-1)
    seed()
    if (newest) { collapseThinking(); currentRunId.value = newest.id }
    else if (!knownRuns.has(currentRunId.value)) currentRunId.value = null
  }, { immediate: true, flush: 'sync' })

  function thinkingVisible(message) {
    return expanded.value[message.id] ?? (currentRunId.value !== null && message.run_id === currentRunId.value)
  }
  function toggleThinking(message) { expanded.value[message.id] = !thinkingVisible(message) }
  return { thinkingVisible, toggleThinking, activateThinking, leaveThinking, acceptThinking }
}
