const ROOT = '/api/town'

async function request(path, body) {
  let response, data
  try {
    response = await fetch(`${ROOT}${path}`, body ? {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    } : { cache: 'no-store' })
    data = await response.json()
  } catch (cause) {
    throw Object.assign(new Error('连接中断，请先重新读取状态，再决定是否重试。'), { uncertain: true, cause })
  }
  if (!response.ok || data?.ok === false || data?.error) {
    throw Object.assign(new Error(typeof data?.error === 'string' ? data.error : data?.message || '操作未完成'), {
      code: data?.code || data?.error, uncertain: response.status >= 500 || response.status === 408,
    })
  }
  return data
}

export const getTownWallet = () => request('/wallet')
const interactionPath = actorKey => {
  if (String(actorKey).startsWith('location:') && String(actorKey).length > 9) return `/locations/${encodeURIComponent(actorKey.slice(9))}/interactions`
  const [kind, id] = String(actorKey).split(':')
  if (!['npc', 'char'].includes(kind) || !/^[1-9]\d*$/.test(id)) throw new Error('居民身份无效')
  return `/${kind === 'npc' ? 'npcs' : 'characters'}/${id}/interactions`
}
export const fetchTownInteractions = actorKey => request(interactionPath(actorKey))
export const fetchTownTargetTrade = actorKey => request(interactionPath(actorKey).replace(/\/interactions$/, '/trade'))
export const createTownTargetTradeCommand = (actorKey, { worldId, ...body }) => ({ kind: 'npc_trade', worldId,
  path: interactionPath(actorKey).replace(/\/interactions$/, '/trade'), body: { ...body, idempotencyKey: crypto.randomUUID() } })
export const offerTownInteraction = (actorKey, key, scope) => request(interactionPath(actorKey), { ...scope, key })
export const respondTownInteraction = (actorKey, requestId, decision, scope) => request(`${interactionPath(actorKey)}/${encodeURIComponent(requestId)}`, { ...scope, decision })
/** Generic command POST: path and body are built by command constructors on the server's terms. */
export const executeTownLifeCommand = command => request(command.path, command.body)

// NPC 功能点：目录只读；gift 是带幂等键的服务端授权操作。交易走 /trade 直接购买。
export const fetchTownNpcFunctions = npcId => request(`/npcs/${encodeURIComponent(npcId)}/functions`)
export const receiveTownNpcGift = (npcId, { worldEpoch } = {}) => request(`/npcs/${encodeURIComponent(npcId)}/gift`,
  { idempotencyKey: crypto.randomUUID(), ...(Number.isSafeInteger(worldEpoch) ? { worldEpoch } : {}) })

//  NPC 服务 / 打工

/** 为酒馆角色建托管居民档案（服务 / 打工 / 货架项目落库用，幂等）。 */
export const ensureTownCharacterProfile = characterId =>
  request(`/characters/${encodeURIComponent(characterId)}/profile`, {}) 

/** 服务管理面板：拥有「服务」或「打工」职责的居民 + 已有项目数量。 */
export const fetchNpcOfferOverview = worldId => request(`/npc-offers/overview${worldId ? `?worldId=${encodeURIComponent(worldId)}` : ''}`)
export const fetchNpcOffers = (npcId, { worldId, kind } = {}) => request(`/npcs/${encodeURIComponent(npcId)}/offers?${new URLSearchParams({
  ...(worldId ? { worldId } : {}), ...(kind ? { kind } : {}),
})}`)
export const generateNpcOffers = (npcId, kind, worldId) => request(`/npcs/${encodeURIComponent(npcId)}/offers/generate`, { kind, worldId })
export const rerollNpcOffer = (npcId, offerId, worldId) => request(`/npcs/${encodeURIComponent(npcId)}/offers/${encodeURIComponent(offerId)}/reroll`, { worldId })
/** 点选服务 / 打工：立即返回 generating，结果通过 town_npc_service_ready 推送。 */
export const startNpcService = (npcId, { offerId, worldId, worldEpoch } = {}) => request(`/npcs/${encodeURIComponent(npcId)}/service/start`, { offerId, worldId, worldEpoch })
export const continueNpcService = (npcId, { sessionId, choice, choiceLabel, worldId, worldEpoch } = {}) =>
  request(`/npcs/${encodeURIComponent(npcId)}/service/continue`, { sessionId, choice, choiceLabel, worldId, worldEpoch })

//  NPC 货架（交易） 

export const fetchNpcStock = (npcId, worldId) => request(`/npcs/${encodeURIComponent(npcId)}/stock${worldId ? `?worldId=${encodeURIComponent(worldId)}` : ''}`)
export const refreshNpcStock = (npcId, worldId) => request(`/npcs/${encodeURIComponent(npcId)}/stock/refresh`, { worldId })
export const buyNpcStock = (npcId, stockId, { worldId, worldEpoch } = {}) =>
  request(`/npcs/${encodeURIComponent(npcId)}/stock/${encodeURIComponent(stockId)}/buy`, { worldId, worldEpoch, idempotencyKey: crypto.randomUUID() })
