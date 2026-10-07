const VERSION = 1
const STEPS = new Set(['config', 'working', 'groundList', 'tiles', 'buildingList', 'buildings', 'npcs', 'player', 'town'])

export function townInitDraftKey(snapshot) {
  return `linshe:town-init-draft:${JSON.stringify([snapshot?.worldId ?? null, snapshot?.worldEpoch ?? null])}`
}

// 请求中的标记不能跨页面恢复，否则按钮会一直停在加载状态。
export function encodeTownInitDraft(draft) {
  return JSON.stringify({ ...draft, version: VERSION }, (key, value) =>
    /busy$/i.test(key) ? false : value)
}

export function readTownInitDraft(storage, key) {
  try {
    const draft = JSON.parse(storage.getItem(key))
    if (draft?.version !== VERSION || !STEPS.has(draft.localStep)) return null
    if (!draft.form || !draft.bpForm || !draft.stepParams || !draft.listBaselines) return null
    if (!['groundAssets', 'roadAssets', 'buildings', 'props', 'npcs'].every(k => Array.isArray(draft.bpForm[k]))) return null
    return JSON.parse(encodeTownInitDraft(draft))
  } catch {
    return null
  }
}
