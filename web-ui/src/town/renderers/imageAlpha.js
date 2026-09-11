const alphaCache = new WeakMap()
const footCache = new WeakMap()

// Image-coordinate bottom edge of the last row that survives alpha testing.
export function alphaFootV({ data, width, height }, cutoff = 0.3) {
  for (let y = height - 1; y >= 0; y--) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] / 255 >= cutoff) return (y + 1) / height
    }
  }
  return 1
}

export function imageFootV(image, cutoff = 0.3) {
  let cached = footCache.get(image)
  if (cached?.cutoff === cutoff) return cached.v
  // Populate the same pixel cache used for picking; source images stay untouched.
  imageAlphaHit(image, 0.5, 0.5, cutoff)
  const alpha = alphaCache.get(image)
  const v = alpha ? alphaFootV(alpha, cutoff) : 1
  footCache.set(image, { cutoff, v })
  return v
}

export function imageAlphaHit(image, u, v, cutoff = 0.3) {
  if (!image || u < 0 || v < 0 || u > 1 || v > 1) return false
  let alpha = alphaCache.get(image)
  if (!alpha) {
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth || image.width; canvas.height = image.naturalHeight || image.height
    try {
      const ctx = canvas.getContext('2d', { willReadFrequently: true }); ctx.drawImage(image, 0, 0)
      alpha = ctx.getImageData(0, 0, canvas.width, canvas.height)
      alphaCache.set(image, alpha)
    } catch { return false }
  }
  const x = Math.min(alpha.width - 1, Math.floor(u * alpha.width))
  const y = Math.min(alpha.height - 1, Math.floor(v * alpha.height))
  return alpha.data[(y * alpha.width + x) * 4 + 3] / 255 >= cutoff
}
