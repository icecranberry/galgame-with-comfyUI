// Attach durable work to the assistant message that created it. Model prose never
// controls card markup or confirmation actions; only real tool results do.
export function godMessageWork(turn, message) {
  const assistants = (turn.messages || []).filter(m => m.role === 'assistant')
  const owners = new Map()
  for (const assistant of assistants) {
    for (const call of assistant.tool_calls || []) {
      const ledger = (turn.calls || []).find(entry => entry.id.endsWith(`:${call.id}`))
      let result = ledger?.result
      if (!result) {
        const response = (turn.messages || []).find(m => m.role === 'tool' && m.tool_call_id === call.id)
        try { result = JSON.parse(response?.content || 'null') } catch { /* incomplete stream */ }
      }
      if (!result?.ok) continue
      const id = result.value?.change_id || result.value?.batch_id
      if (id && !owners.has(id)) owners.set(id, assistant.id)
    }
  }
  return (turn.work || []).filter(work => owners.get(work.id) === message.id
    // Old history without tool linkage remains readable, without an extra footer card.
    || (!owners.has(work.id) && turn.status !== 'running' && assistants.at(-1)?.id === message.id))
}
