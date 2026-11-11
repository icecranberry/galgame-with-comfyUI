export const PHOTO_ASPECT_RATIOS = ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16']
export const DEFAULT_PHOTO_STUDIO_DIMENSIONS = Object.freeze({ width: 1152, height: 2048 })

export function initialPhotoStudioFrame(saved = {}) {
  // Migrate the former implicit 3:4 default once; explicit new choices and custom sizes survive.
  const formerDefault = saved.frameVersion !== 2 && Number(saved.width) === 1200 && Number(saved.height) === 1600 && (!saved.aspectRatio || saved.aspectRatio === '3:4')
  if (!saved.width || !saved.height || formerDefault) return { ...DEFAULT_PHOTO_STUDIO_DIMENSIONS, aspectRatio: '9:16' }
  const width = clampPhotoDimension(saved.width), height = clampPhotoDimension(saved.height)
  const aspectRatio = [...PHOTO_ASPECT_RATIOS, 'custom'].includes(saved.aspectRatio) ? saved.aspectRatio : inferPhotoAspectRatio(width, height)
  // Either slider can be the anchor; retain valid rounded sizes across remounts.
  if (aspectRatio === 'custom' || ['width', 'height'].some(anchor => {
    const dimensions = resizePhoto({ width, height, ratio: aspectRatio, anchor })
    return dimensions.width === width && dimensions.height === height
  })) return { width, height, aspectRatio }
  return { ...resizePhoto({ width, height, ratio: aspectRatio }), aspectRatio }
}

const MIN = 512
const MAX = 2048
const ALIGNMENT = 8

export function clampPhotoDimension(value) {
  const number = Number(value)
  return Math.max(MIN, Math.min(MAX, Math.round((Number.isFinite(number) ? number : MIN) / ALIGNMENT) * ALIGNMENT))
}

export function photoDimensionControls() {
  return { width: { min: MIN, max: MAX, step: ALIGNMENT }, height: { min: MIN, max: MAX, step: ALIGNMENT } }
}

export function resizePhoto({ width, height, ratio, anchor = 'width' }) {
  if (!PHOTO_ASPECT_RATIOS.includes(ratio)) {
    return { width: clampPhotoDimension(width), height: clampPhotoDimension(height) }
  }
  const [w, h] = ratio.split(':').map(Number)
  const axis = anchor === 'height' ? 'height' : 'width'
  const value = clampPhotoDimension(axis === 'width' ? width : height)
  // Scale proportionally, then round to the workflow grid. Requiring exact ratio
  // multiples would prevent ratios such as 9:16 from reaching a 512px short edge.
  const scale = Math.max(MIN / Math.min(w, h), Math.min(MAX / Math.max(w, h), value / (axis === 'width' ? w : h)))
  return { width: clampPhotoDimension(scale * w), height: clampPhotoDimension(scale * h) }
}

export function inferPhotoAspectRatio(width, height) {
  const exact = PHOTO_ASPECT_RATIOS.find(ratio => {
    const [w, h] = ratio.split(':').map(Number)
    return Number(width) * h === Number(height) * w
  })
  return exact || PHOTO_ASPECT_RATIOS.find(ratio => ['width', 'height'].some(anchor => {
    const dimensions = resizePhoto({ width, height, ratio, anchor })
    return dimensions.width === Number(width) && dimensions.height === Number(height)
  })) || 'custom'
}
