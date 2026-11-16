// Shared deterministic renderer; the backend uses the same effects for automatic finishing.
export { STUDIO_FRAMES, STUDIO_FILTERS, defaultFinishRecipe, normalizeStudioFrame, normalizeStudioFilter, studioFilterLayers, studioFinishLayout, renderStudioFinish } from '../../../agent-core/src/shared/photoStudioFinishRenderer.js'

export function loadFinishImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('原片加载失败，请重试'))
    image.src = url
  })
}

export function finishBlob(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('导出失败，请重试')), 'image/png'))
}
export async function downloadStudioFinish(blob, filename) {
  const bridge = window.AndroidBridge
  if (bridge && typeof bridge.saveImage === 'function') {
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('读取成品失败')); reader.readAsDataURL(blob)
    })
    const result = bridge.saveImage(filename, data)
    if (result === 'permission_pending') return '已请求相册权限，授权后将自动保存'
    if (result !== 'ok') throw new Error(`保存到相册失败：${result || '未知错误'}`)
    return '已保存到相册「邻舍」'
  }
  const url = URL.createObjectURL(blob), link = document.createElement('a')
  link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
  return '已开始下载'
}
