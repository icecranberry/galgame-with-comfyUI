import { agentBob } from './agentMotion.js'
import { objectAnchor, isoToGround, cellCenterWorld } from './projection.js'
import { adaptBuildingVolume } from './buildingVolumeProfile.js'

const positive = (value, fallback) => Number.isFinite(value) && value > 0 ? value : fallback
export function renderMeta(asset = {}, instance = {}) {
  const m = { ...asset.meta, ...instance.render }
  return {
    projection: ['topdown_square', 'legacy_iso_diamond', 'legacy_iso_card'].includes(m.projection) ? m.projection : (['ground', 'road'].includes(asset.kind) ? 'legacy_iso_diamond' : 'legacy_iso_card'),
    anchor: { u: Number.isFinite(m.anchor?.u) ? Math.max(0, Math.min(1, m.anchor.u)) : 0.5, v: Number.isFinite(m.anchor?.v) ? Math.max(0, Math.min(1, m.anchor.v)) : 1 },
    autoFoot: !Number.isFinite(m.anchor?.v),
    worldHeight: positive(m.worldHeight, null),
    alphaCutoff: Number.isFinite(m.alphaCutoff) ? Math.max(0.01, Math.min(1, m.alphaCutoff)) : 0.3,
    shadowMode: ['none', 'alpha_card', 'volume'].includes(m.shadowMode) ? m.shadowMode : asset.kind === 'building' && m.footprint ? 'volume' : 'alpha_card',
    // 建筑/道具是「生成图降采样」的插画贴图：默认 linear + mipmap，缩小不锯齿、放大不结块；
    // 地砖/路面保持 nearest，维持像素风硬边（单张素材可用 meta.textureFilter 覆盖）。
    textureFilter: m.textureFilter === 'linear' || m.textureFilter === 'nearest'
      ? m.textureFilter
      : (asset.kind === 'building' || asset.kind === 'prop' ? 'linear' : 'nearest'),
  }
}
export const assetUrl = asset => {
  const path = asset?.imagePath || asset?.image_path
  return path ? `${path}?v=${asset.meta?.updatedAt ?? 0}` : null
}
export function adaptObject(obj, asset) {
  const anchor = objectAnchor(obj, asset?.meta)
  const dto = { ...obj, ...anchor, grid: { x: obj.x, y: obj.y }, ground: isoToGround(anchor.x, anchor.y), asset, render: renderMeta(asset, obj), url: assetUrl(asset) }
  const volume = adaptBuildingVolume(asset, obj)
  if (volume) { dto.volume = volume; dto.render.projection = 'modular_volume' }
  return dto
}
export function adaptAgent(agent, pos, direction, nowMs = 0) {
  const anchor = cellCenterWorld(pos.x, pos.y)
  const urls = [...new Set([agent.sprites?.[direction], agent.standingUrl, agent.avatarPath].filter(Boolean))]
  return { agent, pos, bob: agentBob(agent, pos, nowMs), ground: isoToGround(anchor.x, anchor.y), urls, url: urls[0] || null }
}
// UV order: north, east, south, west. Respect cropped legacy tile height/anchor.
export function groundUvs(asset, width = 64, height = 32) {
  if (renderMeta(asset).projection === 'topdown_square') return [[0, 1], [1, 1], [1, 0], [0, 0]]
  const custom = asset?.meta?.contentDiamondUv
  if (Array.isArray(custom) && custom.length === 4 && custom.every(p => Array.isArray(p) && p.length === 2 && p.every(v => Number.isFinite(v) && v >= 0 && v <= 1))) return custom
  const center = 1 - (asset?.meta?.groundAnchorY ?? 0.5)
  const half = width / (4 * height)
  const inset = asset?.kind === 'ground' ? 4 : 0.5
  const u = inset * 2 / width, v = inset / height
  return [[0.5, Math.min(1 - v, center + half - v)], [1 - u, center], [0.5, Math.max(v, center - half + v)], [u, center]]
}
