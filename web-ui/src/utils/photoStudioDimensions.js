export const PHOTO_ASPECT_RATIOS = ['3:2', '2:3', '4:3', '3:4', '16:9', '9:16']
export const DEFAULT_PHOTO_STUDIO_DIMENSIONS = Object.freeze({ width: 1152, height: 2048 })

export function initialPhotoStudioFrame(saved = {}) {
  // Migrate the former implicit 3:4 default once; explicit new choices and custom sizes survive.
  const formerDefault = saved.frameVersion !== 2 && Number(saved.width) === 1200 && Number(saved.height) === 1600 && (!saved.aspectRatio || saved.aspectRatio === '3:4')
  if (!saved.width || !saved.height || formerDefault) return { ...DEFAULT_PHOTO_STUDIO_DIMENSIONS, aspectRatio: '9:16' }
  const width = clampPhotoDimension(saved.width), height = clampPhotoDimension(saved.height)
  const aspectRatio = [...PHOTO_ASPECT_RATIOS, 'custom'].includes(saved.aspectRatio) ? saved.aspectRatio : inferPhotoAspectRatio(width, height)
  return { ...resizePhoto({ width, height, ratio: aspectRatio }), aspectRatio }
}

const MIN = 512
const MAX = 2048
const ALIGNMENT = 8

export function clampPhotoDimension(value) {
  const number = Number(value)
  return Math.max(MIN, Math.min(MAX, Math.round((Number.isFinite(number) ? number : MIN) / ALIGNMENT) * ALIGNMENT))
}

export function photoDimensionControls(ratio) {
  if (!PHOTO_ASPECT_RATIOS.includes(ratio)) {
    return { width: { min: MIN, max: MAX, step: ALIGNMENT }, height: { min: MIN, max: MAX, step: ALIGNMENT } }
  }
  // Both axes stay aligned to the workflow's 8px grid without drifting from the selected ratio.
  const [w, h] = ratio.split(':').map(Number).map(value => value * ALIGNMENT)
  const first = Math.ceil(Math.max(MIN / w, MIN / h))
  const last = Math.floor(Math.min(MAX / w, MAX / h))
  return { width: { min: first * w, max: last * w, step: w }, height: { min: first * h, max: last * h, step: h } }
}

export function resizePhoto({ width, height, ratio, anchor = 'width' }) {
  if (!PHOTO_ASPECT_RATIOS.includes(ratio)) {
    return { width: clampPhotoDimension(width), height: clampPhotoDimension(height) }
  }
  const controls = photoDimensionControls(ratio)
  const axis = anchor === 'height' ? 'height' : 'width'
  const value = clampPhotoDimension(axis === 'width' ? width : height)
  const { min, max, step } = controls[axis]
  const scale = Math.round(Math.max(min, Math.min(max, value)) / step)
  return { width: scale * controls.width.step, height: scale * controls.height.step }
}

export function inferPhotoAspectRatio(width, height) {
  return PHOTO_ASPECT_RATIOS.find(ratio => {
    const [w, h] = ratio.split(':').map(Number)
    return Number(width) * h === Number(height) * w
  }) || 'custom'
}
