// Shared with Canvas: keep identity selection free of Three/WebGL imports.
export function interactionSubjectKeys(keys) {
  return new Set(['me', ...(Array.isArray(keys) || keys instanceof Set ? [...keys].filter(k => typeof k === 'string' && k.length) : [])])
}
export const isInteractionSubject = (agent, keys) => keys.has(agent?.agentKey) || keys.has(agent?.actorId)
