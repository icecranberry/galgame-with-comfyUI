// Non-destructive, versioned runtime derivative. Old PNGs and their metadata stay intact.
export const GROUND_DERIVATIVE_VERSION = 1
const topdownCache = new WeakMap()
export function canvasGroundImage(image, asset) {
  if (!image || asset?.meta?.projection !== 'topdown_square') return image
  let canvas = topdownCache.get(image)
  if (!canvas) {
    canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 32
    const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = false
    ctx.setTransform(32, 16, -32, 16, 32, 0)
    ctx.drawImage(image, 0, 0, 1, 1)
    topdownCache.set(image, canvas)
  }
  return canvas
}
export function deriveGroundPixels(source, width, height, anchorY = 0.5, removeWhiteEdge = true) {
  const pixels = new Uint8ClampedArray(source)
  const cx = width / 2, cy = height * anchorY, rx = width / 2, ry = width / 4
  const white = i => source[i] > 220 && source[i + 1] > 220 && source[i + 2] > 220 && Math.max(source[i], source[i + 1], source[i + 2]) - Math.min(source[i], source[i + 1], source[i + 2]) < 25
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy
    const radius = Math.abs(dx) / rx + Math.abs(dy) / ry
    if (radius < 0.76 || radius > 1.12) continue
    const i = (y * width + x) * 4
    if (source[i + 3] >= 128 && !(removeWhiteEdge && white(i))) continue
    // Extend interior color into the contour/gutter, including a painted white fringe.
    for (const scale of [0.82, 0.7, 0.58]) {
      const sx = Math.max(0, Math.min(width - 1, Math.floor(cx + dx * scale)))
      const sy = Math.max(0, Math.min(height - 1, Math.floor(cy + dy * scale)))
      const j = (sy * width + sx) * 4
      if (source[j + 3] < 128 || (removeWhiteEdge && white(j))) continue
      pixels.set(source.subarray(j, j + 4), i)
      break
    }
  }
  return pixels
}

export function deriveGroundImage(image, asset) {
  if (asset?.meta?.projection === 'topdown_square' || asset?.meta?.groundDerivative === 'none') return image
  const canvas = document.createElement('canvas')
  canvas.width = image.width; canvas.height = image.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(image, 0, 0)
  try {
    const data = ctx.getImageData(0, 0, image.width, image.height)
    data.data.set(deriveGroundPixels(data.data, image.width, image.height, asset?.meta?.groundAnchorY ?? 0.5, asset?.kind === 'ground' && asset?.meta?.removeWhiteEdge !== false))
    ctx.putImageData(data, 0, 0)
    return canvas
  } catch { return image }
}
