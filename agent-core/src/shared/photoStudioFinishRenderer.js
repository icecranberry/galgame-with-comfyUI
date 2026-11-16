// Shared browser/worker entry point. Frame and filter behavior live in their own modules.
import { normalizeStudioFrame, DEFAULT_STUDIO_CAMERA_SETTINGS, studioFinishLayout, drawStudioFrame } from './photoStudioFrames.js'
import { normalizeStudioFilter, applyStudioFilter } from './photoStudioFilters.js'
export { STUDIO_FRAMES, normalizeStudioFrame, DEFAULT_STUDIO_CAMERA_SETTINGS, studioFinishLayout } from './photoStudioFrames.js'
export { STUDIO_FILTERS, normalizeStudioFilter } from './photoStudioFilters.js'

export function defaultFinishRecipe() {
  return { version: 3, frame: 'classic', filter: 'none', intensity: 100, border: 'thin', tone: 'light', grain: true, caption: '', cameraSettings: DEFAULT_STUDIO_CAMERA_SETTINGS }
}

// Legacy single-filter recipes remain valid; layers are applied in selection order.
export function studioFilterLayers(recipe) {
  const layers = Array.isArray(recipe.filters) ? recipe.filters : [recipe]
  return layers.map(({ filter, intensity, grain }) => ({ filter: normalizeStudioFilter(filter), intensity, grain }))
    .filter(layer => layer.filter && layer.filter !== 'none')
}

// Stable integer noise: preview and export share a frozen texture, not Math.random().
function noise(x, y) {
  let n = Math.imul(x + 17, 374761393) ^ Math.imul(y + 31, 668265263)
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295
}

function canvas(width, height) {
  const result = document.createElement('canvas')
  result.width = width; result.height = height
  return result
}

const browserPath = data => new Path2D(data)
/** Shared full-resolution rendering for traditional mounts and masked comic compositions. */
export function renderStudioFinish(image, recipe, { maxSide = Infinity, createCanvas = canvas, createPath = browserPath } = {}) {
  recipe = { ...recipe, frame: normalizeStudioFrame(recipe.frame), filter: normalizeStudioFilter(recipe.filter), cameraSettings: recipe.cameraSettings ?? DEFAULT_STUDIO_CAMERA_SETTINGS }
  const scale = Math.min(1, maxSide / Math.max((image.naturalWidth || image.width), (image.naturalHeight || image.height)))
  const w = Math.max(1, Math.round((image.naturalWidth || image.width) * scale)), h = Math.max(1, Math.round((image.naturalHeight || image.height) * scale))
  const s = Math.min(w, h)
  const { x, y, bottom, width: W, height: H } = studioFinishLayout(w, h, recipe)
  if (W * H > 40_000_000 || W > 16384 || H > 16384) throw new Error('原片尺寸过大，请使用较小的照片装裱（成品上限 4000 万像素）')
  const output = createCanvas(W, H), ctx = output.getContext('2d')
  const photo = createCanvas(w, h), pc = photo.getContext('2d', { willReadFrequently: true })
  pc.drawImage(image, 0, 0, w, h)
  for (const layer of studioFilterLayers(recipe)) applyStudioFilter(pc, w, h, layer, noise)
  drawStudioFrame(ctx, photo, recipe, { x, y, w, h, W, H, s, bottom }, { noise, createPath })
  photo.width = photo.height = 1
  return output
}
