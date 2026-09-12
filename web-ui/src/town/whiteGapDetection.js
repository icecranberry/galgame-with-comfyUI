/** Local white removal preview. Strength is region granularity: how small a contiguous
 * near-white region still gets removed, never a per-pixel colour tolerance. */
export const MAX_WHITE_GAP_PIXELS = 16_000_000
const MAX_MARKERS = 500
// Fixed colour test, independent of the slider: pixels whose darkest RGB channel sits
// within 5 steps of white (the old strength 12 admitted RGB minimum >= 250).
const MAX_WHITE_DISTANCE = 5

export function normalizeWhiteGapStrength(value) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : 0
}

/** First slider step that removes a contiguous white region of `area` pixels:
 * whole-canvas blocks at 1, single-pixel specks at 100. Log scaled so "large blocks"
 * stay reachable at low strengths on any canvas size. */
export function whiteGapRegionThreshold(area, totalPixels) {
  const ratio = Math.log(Math.max(1, area)) / Math.log(Math.max(2, totalPixels))
  return Math.max(1, Math.min(100, Math.round(100 * (1 - ratio))))
}

/** 0 preserves the image; 100 removes every near-white pixel.
 * Regions are 4-connected groups of near-white pixels and are removed whole or not at
 * all: every pixel of a region carries the region's area-derived threshold, so region
 * size decides eligibility while shape, position and contact with transparency do not.
 */
export function buildWhiteGapStrengthMap(rgba, width, height) {
  const count = width * height
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 ||
      count > MAX_WHITE_GAP_PIXELS || rgba.length !== count * 4) {
    throw new Error('图片尺寸无效或过大，请使用不超过 1600 万像素的图片')
  }
  const candidates = new Uint8Array(count)
  for (let i = 0; i < count; i++) {
    const o = i * 4
    if (rgba[o + 3] === 0) continue // Hidden RGB must not seed or join a region.
    if (255 - Math.min(rgba[o], rgba[o + 1], rgba[o + 2]) <= MAX_WHITE_DISTANCE) candidates[i] = 1
  }

  // Flood-fill each region once, then stamp the region's threshold on every member pixel.
  const thresholds = new Uint8Array(count)
  const seen = new Uint8Array(count)
  const queue = new Uint32Array(count)
  const pixelCounts = new Uint32Array(101)
  const regionCounts = new Uint32Array(101)
  const regions = []
  let totalRegions = 0
  for (let seed = 0; seed < count; seed++) {
    if (!candidates[seed] || seen[seed]) continue
    let head = 0, tail = 1, minX = width, minY = height, maxX = 0, maxY = 0
    queue[0] = seed
    seen[seed] = 1
    const visit = i => {
      if (candidates[i] && !seen[i]) { seen[i] = 1; queue[tail++] = i }
    }
    while (head < tail) {
      const i = queue[head++], x = i % width, y = Math.floor(i / width)
      minX = Math.min(minX, x); maxX = Math.max(maxX, x)
      minY = Math.min(minY, y); maxY = Math.max(maxY, y)
      // Four-connected groups keep diagonal outlines distinct.
      if (x > 0) visit(i - 1)
      if (x < width - 1) visit(i + 1)
      if (y > 0) visit(i - width)
      if (y < height - 1) visit(i + width)
    }
    const strength = whiteGapRegionThreshold(tail, count)
    for (let j = 0; j < tail; j++) thresholds[queue[j]] = strength
    pixelCounts[strength] += tail
    regionCounts[strength]++
    totalRegions++
    // Keep marker memory bounded even on noisy images with millions of isolated white pixels.
    const last = regions[regions.length - 1]
    if (regions.length === MAX_MARKERS &&
        (strength > last.firstStrength || (strength === last.firstStrength && tail <= last.area))) continue
    const bounds = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
    let anchor = null, anchorDistance = Infinity
    for (let j = 0; j < tail; j++) {
      const i = queue[j]
      const x = i % width + 0.5, y = Math.floor(i / width) + 0.5
      const distance = (x - minX - bounds.w / 2) ** 2 + (y - minY - bounds.h / 2) ** 2
      if (distance < anchorDistance) { anchor = { x, y }; anchorDistance = distance }
    }
    const marker = { bounds, firstStrength: strength, anchor, area: tail }
    const position = regions.findIndex(r => strength < r.firstStrength || (strength === r.firstStrength && tail > r.area))
    if (position < 0) regions.push(marker)
    else regions.splice(position, 0, marker)
    if (regions.length > MAX_MARKERS) regions.pop()
  }
  for (let strength = 1; strength <= 100; strength++) {
    pixelCounts[strength] += pixelCounts[strength - 1]
    regionCounts[strength] += regionCounts[strength - 1]
  }
  // Limit display clutter, never discard pixels from the removal mask.
  return { thresholds, pixelCounts, regionCounts,
    regions: regions.map(({ bounds, firstStrength, anchor }) => ({ bounds, firstStrength, anchor })),
    omitted: totalRegions - regions.length }
}

/** Always derive from the untouched working image: lowering strength restores the exact
 * original alpha. A selected region goes away whole, matching the manual flood fill. */
export function applyWhiteGapStrength(original, thresholds, value) {
  if (original.length !== thresholds.length * 4) throw new Error('留白检测结果与当前图片尺寸不一致')
  const strength = normalizeWhiteGapStrength(value)
  const pixels = new Uint8ClampedArray(original)
  for (let i = 0; i < thresholds.length; i++) {
    if (thresholds[i] && thresholds[i] <= strength) pixels[i * 4 + 3] = 0
  }
  return pixels
}
