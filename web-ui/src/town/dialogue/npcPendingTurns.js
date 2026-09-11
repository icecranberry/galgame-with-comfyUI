// Transient request identity only; messages/history remain exclusively on the original API.
// Kept across stage unmounts so reopening cannot turn an uncertain request into a second generation.
import { reactive } from 'vue'
const pending = new Map()
export const npcTurnKey = (npcId, worldId, worldEpoch) => JSON.stringify([worldId, worldEpoch, npcId])
export const getNpcPendingTurn = key => pending.get(key)
export function createNpcPendingTurn(key, text, options) {
  const turn = reactive({ text, options: { ...options, clientMessageId: crypto.randomUUID() }, status: 'pending', promise: null })
  pending.set(key, turn)
  return turn
}
export function forgetNpcPendingTurn(key, turn) { if (pending.get(key) === turn) pending.delete(key) }
