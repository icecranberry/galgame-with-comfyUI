import { DEFAULT_PHOTO_STUDIO_DIMENSIONS, PHOTO_STUDIO_DIMENSION_LIMITS } from '../../../agent-core/src/shared/photoStudioDimensions.js'

export { DEFAULT_PHOTO_STUDIO_DIMENSIONS }
export const PHOTO_ASPECT_RATIOS = ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16']
export const PHOTO_STUDIO_FRAME_VERSION = 3

const { min: MIN, max: MAX, step: ALIGNMENT } = PHOTO_STUDIO_DIMENSION_LIMITS

export function initialPhotoStudioFrame(saved = {}) {
  // Old sessions saved the default and manual choices in the same fields.
  const formerPortraitDefault = saved.frameVersion === 2 && Number(saved.width) === 1152 && Number(saved.height) === 2048 && saved.aspectRatio === '9:16'
  const formerThreeByFourDefault = (saved.frameVersion ?? 0) < 2 && Number(saved.width) === 1200 && Number(saved.height) === 1600 && (!saved.aspectRatio || saved.aspectRatio === '3:4')
  if (!saved.width || !saved.height || formerPortraitDefault || formerThreeByFourDefault) {
    return { ...DEFAULT_PHOTO_STUDIO_DIMENSIONS, aspectRatio: '9:16' }
  }
  const width = clampPhotoDimension(saved.width), height = clampPhotoDimension(saved.height)
  const aspectRatio = [...PHOTO_ASPECT_RATIOS, 'custom'].includes(saved.aspectRatio) ? saved.aspectRatio : inferPhotoAspectRatio(width, height)
  // Keep rounded dimensions produced by a slider or by switching ratios.
  if (aspectRatio === 'custom' || ['width', 'height', 'average'].some(anchor => {
    const dimensions = resizePhoto({ width, height, ratio: aspectRatio, anchor })
    return dimensions.width === width && dimensions.height === height
  })) return { width, height, aspectRatio }
  return { ...resizePhoto({ width, height, ratio: aspectRatio }), aspectRatio }
}

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
  let scale = clampPhotoDimension(width) / w
  if (anchor === 'height') scale = clampPhotoDimension(height) / h
  if (anchor === 'average') scale = (clampPhotoDimension(width) + clampPhotoDimension(height)) / (w + h)
  // Scale proportionally, then round to the workflow grid. Requiring exact ratio
  // multiples would prevent ratios such as 9:16 from reaching a 512px short edge.
  scale = Math.max(MIN / Math.min(w, h), Math.min(MAX / Math.max(w, h), scale))
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
