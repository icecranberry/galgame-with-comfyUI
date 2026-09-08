// Asset-level opt-in only. Instance overrides and asset names cannot opt legacy art in.
export const MODULAR_VOLUME_VERSION = 1
export const BUILDING_PROFILES = Object.freeze({
  cafe: Object.freeze({ label: '咖啡馆', height: 2.2, roofRise: .85, wall: '#e6d3b5', roof: '#a36855', trim: '#765746', sign: '#6f8270' }),
  workshop: Object.freeze({ label: '工坊', height: 2.5, roofRise: .65, wall: '#c7b59a', roof: '#617878', trim: '#705b49', sign: '#b67b58' }),
  notice_station: Object.freeze({ label: '公告站', height: 1.8, roofRise: .7, wall: '#ded3b9', roof: '#75866a', trim: '#82654d', sign: '#9d7160' }),
})

export function adaptBuildingVolume(asset, instance = {}) {
  const m = asset?.meta
  if (asset?.kind !== 'building' || m?.projection !== 'modular_volume'
    || m.modularVolumeVersion !== MODULAR_VOLUME_VERSION
    || !Object.hasOwn(BUILDING_PROFILES, m.buildingProfile)) return null
  const { w, h } = m.footprint || {}
  // Bounded prototype geometry; unsupported contracts retain the legacy card.
  if (![w, h].every(n => Number.isInteger(n) && n >= 2 && n <= 12)
    || !Number.isInteger(instance.x) || !Number.isInteger(instance.y)) return null
  const { dx, dy } = m.doorOffset || { dx: w - 1, dy: h - 1 }
  if (![dx, dy].every(Number.isInteger) || dx < 0 || dx >= w || dy < 0 || dy >= h
    || (dx !== 0 && dx !== w - 1 && dy !== 0 && dy !== h - 1)) return null
  const cells = []
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (x !== dx || y !== dy) cells.push({ x, y })
  }
  const textures = {}
  for (const face of ['wall', 'roof', 'sign', 'door']) {
    const url = m.buildingTextures?.[face]
    if (typeof url === 'string' && url.trim()) {
      const value = url.trim()
      const [base, ...hash] = value.split('#')
      textures[face] = m.updatedAt != null && !value.startsWith('data:')
        ? `${base}${base.includes('?') ? '&' : '?'}v=${encodeURIComponent(m.updatedAt)}${hash.length ? `#${hash.join('#')}` : ''}` : value
    }
  }
  return {
    version: MODULAR_VOLUME_VERSION, profile: m.buildingProfile, palette: BUILDING_PROFILES[m.buildingProfile],
    width: w, depth: h, origin: { x: instance.x, z: instance.y - h + 1 }, cells,
    door: { dx, dy, side: dy === h - 1 ? 'south' : dx === w - 1 ? 'east' : dy === 0 ? 'north' : 'west' },
    textures,
  }
}
