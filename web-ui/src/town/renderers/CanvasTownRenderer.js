import { agentBob } from './agentMotion.js'
import { HW, HH, cellTopWorld, cellCenterWorld, objectRect, objectAnchor } from './projection.js'
import { assetUrl } from './TownSceneAdapter.js'
import { imageAlphaHit } from './imageAlpha.js'
import { canvasGroundImage } from './groundTexture.js'

// No store subscriptions or animation loop: TownView owns the single clock and RAF.
export function createCanvasTownRenderer({ getImg, agentFacing, isImagePending = () => false }) {
let scene = null, staticCanvas = null, staticDirty = true
let hoverKey = null, selectedKey = null, groundScale = 1, heightScale = 1
let lastDrawables = []
const GROUND_ANCHOR_Y = 0.5
const assetById = id => scene?.assets?.find(a => a.id === id)
const objRect = obj => objectRect(obj, assetById(obj.assetId)?.meta)
const groundTileDrawSize = img => ({ w: HW * 2, h: HW * 2 * (img.naturalHeight || img.height) / Math.max(1, img.naturalWidth || img.width) })
function bakeStatic() {
  const m = scene
  if (!m) { staticCanvas = null; return }
  const offX = m.rows * HW                       // 最西格的左顶点 x = -rows*HW → 平移到 0
  const offY = 32                                // 顶部余量（贴图上沿超出菱形顶点）
  const W = (m.cols + m.rows) * HW
  const H = (m.cols + m.rows) * HH + 64
  staticCanvas = staticCanvas || document.createElement('canvas')
  staticCanvas.width = W
  staticCanvas.height = H
  const c = staticCanvas.getContext('2d')
  c.imageSmoothingEnabled = false
  c.clearRect(0, 0, W, H)

  const groundImgs = new Map() // assetId -> { img, anchorY }
  let imgPending = false // 贴图尚未加载完 → 保持 dirty，下一帧重烘焙
  // 按 (cx+cy) 从后往前涂：前排地砖的侧沿会盖住后排的
  for (let s = 0; s <= m.cols + m.rows - 2; s++) {
    for (let cx = Math.max(0, s - m.rows + 1); cx <= Math.min(m.cols - 1, s); cx++) {
      const cy = s - cx
      const top = cellTopWorld(cx, cy)
      const px = top.x + offX
      const py = top.y + offY
      const groundId = m.layers?.ground?.[cy]?.[cx]
      const roadId = m.layers?.road?.[cy]?.[cx]
      for (const id of [groundId, roadId]) {
        if (!id) continue
        let entry = groundImgs.get(id)
        if (entry === undefined) {
          const asset = assetById(id)
          const img = asset ? canvasGroundImage(getImg(assetUrl(asset)), asset) : null
          if (!img && asset && isImagePending(assetUrl(asset))) imgPending = true
          entry = img ? { img, anchorY: asset?.meta?.projection === 'topdown_square' ? 0.5 : asset?.meta?.groundAnchorY ?? GROUND_ANCHOR_Y } : null
          groundImgs.set(id, entry)
        }
        if (!entry) continue
        const { w, h } = groundTileDrawSize(entry.img)
        c.drawImage(entry.img, px - HW, py + HH - h * entry.anchorY, w, h)
      }
    }
  }
  staticCanvas._offX = offX
  staticCanvas._offY = offY
  staticDirty = imgPending // 贴图加载齐之前每帧重试烘焙
}

function wrapText(text, maxChars) {
  const lines = []
  let cur = ''
  for (const ch of String(text)) {
    cur += ch
    if (cur.length >= maxChars) { lines.push(cur); cur = '' }
  }
  if (cur) lines.push(cur)
  return lines.slice(0, 3)
}

function roundRect(c, x, y, w, h, r) {
  c.beginPath()
  c.moveTo(x + r, y)
  c.arcTo(x + w, y, x + w, y + h, r)
  c.arcTo(x + w, y + h, x, y + h, r)
  c.arcTo(x, y + h, x, y, r)
  c.arcTo(x, y, x + w, y, r)
  c.closePath()
}

function diamondPath(c, cx, cy, hw, hh) {
  c.beginPath()
  c.moveTo(cx, cy - hh)
  c.lineTo(cx + hw, cy)
  c.lineTo(cx, cy + hh)
  c.lineTo(cx - hw, cy)
  c.closePath()
}

function drawBubble(c, text, until, px, py) {
  const remain = until - Date.now()
  if (remain <= 0) return
  const alpha = Math.min(1, remain / 1500)
  const lines = wrapText(text, 12)
  const bw = Math.min(190, Math.max(...lines.map(l => l.length)) * 11 + 18)
  const bh = lines.length * 16 + 12
  const bx = px - bw / 2
  const by = py - bh
  c.save()
  c.globalAlpha = alpha
  roundRect(c, bx, by, bw, bh, 9)
  c.fillStyle = 'rgba(255,254,250,0.96)'
  c.fill()
  c.strokeStyle = '#e8ddd0'
  c.lineWidth = 1
  c.stroke()
  c.beginPath()
  c.moveTo(px - 5, by + bh - 1)
  c.lineTo(px + 5, by + bh - 1)
  c.lineTo(px, by + bh + 6)
  c.closePath()
  c.fill()
  c.fillStyle = '#4a3a2c'
  c.font = '11px "HarmonyOS Sans SC", sans-serif'
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  lines.forEach((line, i) => c.fillText(line, px, by + 12 + i * 16))
  c.restore()
}

function drawNameTag(c, px, py, name) {
  c.save()
  c.font = '10px "HarmonyOS Sans SC", sans-serif'
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  const w = c.measureText(name).width + 10
  roundRect(c, px - w / 2, py - 7, w, 15, 7)
  c.fillStyle = 'rgba(255,253,248,0.9)'
  c.fill()
  c.fillStyle = '#7a6a58'
  c.fillText(name, px, py + 0.5)
  c.restore()
}

/** 建筑等距绘制：贴图底边对齐 footprint 菱形的南顶点 */
function drawObject(c, obj, occluded) {
  const asset = assetById(obj.assetId)
  const img = asset ? getImg(assetUrl(asset)) : null
  const r = objRect(obj)
  const fp = r.fp
  const north = cellTopWorld(r.x0, r.y0)
  const southY = (r.x1 + r.y1 + 2) * HH
  const westX = (r.x0 - r.y1 - 1) * HW
  const eastX = (r.x1 - r.y0 + 1) * HW
  const centerX = (north.x + ((r.x1 - r.y1) * HW)) / 2
  const imgW = eastX - westX
  if (img) {
    const imgH = imgW * (img.naturalHeight / Math.max(1, img.naturalWidth))
    c.save()
    c.globalAlpha = occluded ? 0.62 : 1
    if (obj.flip) {
      c.translate(centerX, 0)
      c.scale(-1, 1)
      c.drawImage(img, -imgW / 2, southY - imgH, imgW, imgH)
    } else {
      c.drawImage(img, centerX - imgW / 2, southY - imgH, imgW, imgH)
    }
    c.restore()
  } else {
    // 无贴图占位：footprint 菱形色块
    c.save()
    c.globalAlpha = occluded ? 0.4 : 0.55
    c.fillStyle = '#b4a08c'
    diamondPath(c, centerX, north.y + (southY - north.y) / 2, imgW / 2, (southY - north.y) / 2)
    c.fill()
    c.restore()
  }
}

function drawAgent(c, a, pos, nowMs, labelsOnly = false) {
  const center = cellCenterWorld(pos.x, pos.y)
  const px = center.x
  const feetY = center.y
  c.save()
  if (labelsOnly) { c.translate(px, feetY); c.scale(1, 1 / groundScale); c.translate(-px, -feetY) }
  const dir = agentFacing(a, pos)
  const spriteUrl = a.sprites?.[dir]
  const isPlayer = a.agentKey === 'me'
  const sleeping = a.sleeping
  const bob = agentBob(a, pos, nowMs)

  if (!labelsOnly) {
  // 落影（贴地小椭圆）
  c.save()
  c.globalAlpha = 0.22
  c.fillStyle = '#3c2f22'
  c.beginPath()
  c.ellipse(px, feetY - 2, HW * 0.32, HH * 0.42, 0, 0, Math.PI * 2)
  c.fill()
  c.restore()

  if (a.agentKey === hoverKey || a.agentKey === selectedKey) {
    c.save()
    c.strokeStyle = 'rgba(224,123,108,0.55)'
    c.lineWidth = 2
    diamondPath(c, px, center.y, HW * 0.62, HH * 0.72)
    c.stroke()
    c.restore()
  }

  const sprite = getImg(spriteUrl)
  const alpha = sleeping ? 0.85 : 1
  let drew = false
  if (sprite) {
    const h = 72
    const w = h * (sprite.naturalWidth && sprite.naturalHeight ? sprite.naturalWidth / sprite.naturalHeight : 0.66)
    c.save()
    c.globalAlpha = alpha
    // 小人是插画素材：单独开平滑缩放（世界层全局是 nearest，贴图锐利）
    c.imageSmoothingEnabled = true
    c.imageSmoothingQuality = 'high'
    c.translate(px, feetY - (sleeping ? 0 : bob))
    try { c.drawImage(sprite, -w / 2, -h, w, h); drew = true } catch { /* ignore */ }
    c.restore()
  }
  if (!drew) {
    const standing = a.standingUrl ? getImg(a.standingUrl) : null
    const avatar = a.avatarPath ? getImg(a.avatarPath) : null
    if (standing) {
      const h = 78
      const w = h * (standing.naturalWidth / Math.max(1, standing.naturalHeight) || 0.7)
      c.save()
      c.globalAlpha = alpha
      c.imageSmoothingEnabled = true
      c.imageSmoothingQuality = 'high'
      c.drawImage(standing, px - w / 2, feetY - h, w, h)
      c.restore()
      drew = true
    } else {
      const r = HW * 0.75
      const cy = feetY - r - bob
      c.save()
      c.globalAlpha = alpha
      c.beginPath()
      c.arc(px, cy, r, 0, Math.PI * 2)
      c.fillStyle = isPlayer ? '#e07b6c' : '#f6efe4'
      c.fill()
      c.lineWidth = 2
      c.strokeStyle = 'rgba(255,255,255,0.95)'
      c.stroke()
      if (avatar) {
        c.beginPath()
        c.arc(px, cy, r - 2, 0, Math.PI * 2)
        c.clip()
        try { c.drawImage(avatar, px - r, cy - r, r * 2, r * 2) } catch { /* ignore */ }
      } else {
        c.fillStyle = '#ffffff'
        c.font = `700 ${Math.round(HH * 1.1)}px "HarmonyOS Sans SC", sans-serif`
        c.textAlign = 'center'
        c.textBaseline = 'middle'
        c.fillText((a.displayName || '?').charAt(0), px, cy + 1)
      }
      c.restore()
      drew = true
    }
  }

  }
  if (labelsOnly && (a.agentKey === hoverKey || a.agentKey === selectedKey)) {
    c.save(); c.strokeStyle = 'rgba(224,123,108,0.65)'; c.lineWidth = 2
    diamondPath(c, px, center.y, HW * 0.62, HH * 0.72 * groundScale); c.stroke(); c.restore()
  }
  if (!labelsOnly || a.agentKey === hoverKey || a.agentKey === selectedKey) drawNameTag(c, px, feetY + HH * 0.6, a.displayName || '我')

  if (sleeping) {
    c.save()
    c.font = '16px "HarmonyOS Sans SC", sans-serif'
    c.textAlign = 'center'
    c.globalAlpha = 0.5 + 0.5 * Math.sin(nowMs / 500)
    c.fillText('💤', px + HW * 0.55, feetY - 60 * heightScale)
    c.restore()
  } else if (a.encounterId) {
    c.save()
    c.font = '15px "HarmonyOS Sans SC", sans-serif'
    c.textAlign = 'center'
    c.fillText('💬', px + HW * 0.55, feetY - 57 * heightScale)
    c.restore()
  }

  if (a.bubble?.text) drawBubble(c, a.bubble.text, a.bubble.until, px, feetY - 72 * heightScale - bob)
  c.restore()
}

/** 居民是否被建筑挡住（站在建筑屏幕投影后方） */
function objectOccludes(obj, agentPositions) {
  const r = objRect(obj)
  const north = cellTopWorld(r.x0, r.y0)
  const southY = (r.x1 + r.y1 + 2) * HH
  const westX = (r.x0 - r.y1 - 1) * HW
  const eastX = (r.x1 - r.y0 + 1) * HW
  for (const pos of agentPositions) {
    const center = cellCenterWorld(pos.x, pos.y)
    const feetY = center.y
    if (feetY < southY && feetY > north.y && center.x > westX && center.x < eastX) return true
  }
  return false
}


return {
  setScene(next) { scene = next; staticDirty = true },
  pick(point, { agentsOnly = false } = {}) {
    for (const d of [...lastDrawables].reverse()) {
      if (d.obj) {
        if (agentsOnly) continue
        const asset = assetById(d.obj.assetId), img = getImg(assetUrl(asset))
        if (!img) continue
        const anchor = objectAnchor(d.obj, asset?.meta)
        const h = anchor.width * img.naturalHeight / img.naturalWidth
        let u = (point.x - anchor.x) / anchor.width + 0.5
        if (d.obj.flip) u = 1 - u
        if (imageAlphaHit(img, u, (point.y - anchor.y + h) / h)) return { kind: 'object', object: d.obj }
      } else {
        const a = d.agent, center = cellCenterWorld(d.pos.x, d.pos.y)
        const sprite = getImg(a.sprites?.[agentFacing(a, d.pos)])
        const img = sprite || getImg(a.standingUrl)
        const h = sprite ? 72 : 78
        if (img) {
          const w = h * img.naturalWidth / img.naturalHeight
          if (imageAlphaHit(img, (point.x - center.x) / w + 0.5, (point.y - center.y + h) / h)) return { kind: 'agent', agent: a }
        } else if (Math.hypot(point.x - center.x, point.y - center.y + HW * 0.75) < HW * 0.75) return { kind: 'agent', agent: a }
      }
    }
    return null
  },
  draw(c, frames, nowMs, { labelsOnly = false, hover = null, selected = null, groundScale: ground = 1, heightScale: height = 1, interactionActorKeys } = {}) {
    hoverKey = hover; selectedKey = selected; groundScale = ground; heightScale = height
    if (!labelsOnly && scene) {
      if (staticDirty) bakeStatic()
      if (staticCanvas) c.drawImage(staticCanvas, -staticCanvas._offX, -staticCanvas._offY)
    }
    const drawables = frames.map(f => ({ ...f, y: cellCenterWorld(f.pos.x, f.pos.y).y }))
    if (!labelsOnly) for (const obj of scene?.layers?.objects || []) {
      const r = objRect(obj)
      drawables.push({ obj, y: (r.x1 + r.y1 + 2) * HH })
    }
    drawables.sort((a, b) => a.y - b.y)
    lastDrawables = drawables
    for (const d of drawables) {
      if (d.obj) drawObject(c, d.obj, assetById(d.obj.assetId)?.kind === 'building' && objectOccludes(d.obj, frames.map(f => f.pos)))
      else drawAgent(c, d.agent, d.pos, nowMs, labelsOnly)
    }
  },
  dispose() { staticCanvas = null; scene = null; lastDrawables = [] },
}
}
