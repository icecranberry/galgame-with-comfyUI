// One logical cell = one world unit. Y is elevation; Z is map y.
export const HW = 32
export const HH = 16
export const PIXELS_PER_UNIT = 32 * Math.SQRT2
export const cellTopWorld = (x, y) => ({ x: (x - y) * HW, y: (x + y) * HH })
export const cellCenterWorld = (x, y) => ({ x: (x - y) * HW, y: (x + y + 1) * HH })
export const worldToCell = (x, y) => ({ x: Math.floor((x / HW + y / HH) / 2), y: Math.floor((y / HH - x / HW) / 2) })
export const isoToGround = (x, y) => ({ x: (x / HW + y / HH) / 2, y: 0, z: (y / HH - x / HW) / 2 })
export function objectRect(obj, meta = {}) {
  const fp = meta.footprint || { w: 1, h: 1 }
  return { x0: obj.x, y0: obj.y - fp.h + 1, x1: obj.x + fp.w - 1, y1: obj.y, fp }
}
export function objectAnchor(obj, meta) {
  const r = objectRect(obj, meta)
  return { x: ((r.x0 - r.y0) + (r.x1 - r.y1)) * HW / 2, y: (r.x1 + r.y1 + 2) * HH, width: (r.fp.w + r.fp.h) * HW }
}
export function inMap(cell, map) {
  return !!cell && !!map && cell.x >= 0 && cell.y >= 0 && cell.x < map.cols && cell.y < map.rows
}
// Same footprint/door and explicit-clear precedence as townMapService.
export function buildBlockedCells(map) {
  const blocked = new Set()
  const assets = new Map((map?.assets || []).map(a => [a.id, a]))
  for (const obj of map?.layers?.objects || []) {
    const asset = assets.get(obj.assetId)
    const meta = asset?.meta || {}
    const fp = meta.footprint
    if (fp?.w > 0 && fp?.h > 0) {
      if (meta.footprintKind === 'prop') {
        if (meta.blocking) for (let y = 0; y < fp.h; y++) for (let x = 0; x < fp.w; x++) {
          blocked.add(`${obj.x + x},${obj.y - fp.h + 1 + y}`)
        }
      } else {
        const door = meta.doorOffset || { dx: fp.w - 1, dy: fp.h - 1 }
        for (let y = 0; y < fp.h; y++) for (let x = 0; x < fp.w; x++) {
          if (x !== door.dx || y !== door.dy) blocked.add(`${obj.x + x},${obj.y - fp.h + 1 + y}`)
        }
      }
    } else if (meta.blocking) blocked.add(`${obj.x},${obj.y}`)
  }
  for (let y = 0; y < (map?.rows || 0); y++) for (let x = 0; x < map.cols; x++) {
    const value = map.layers?.blockOverride?.[y]?.[x]
    if (value === 0) blocked.delete(`${x},${y}`)
    if (value === 1) blocked.add(`${x},${y}`)
  }
  return blocked
}

