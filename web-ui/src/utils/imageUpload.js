// 部分手机 ROM 的相册多选会返回取消，WebView 因此连 change 都不派发。
// 手机与安卓壳统一单选；业务可逐张追加到自己的图片列表。
export function canSelectMultipleImages(isMobile, androidBridge = globalThis.window?.AndroidBridge) {
  return !isMobile && !androidBridge
}

// 相册可能不提供 MIME，或统一标记为 application/octet-stream。
const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif|bmp|heic|heif|avif)$/i
export function isImageFile(file) {
  return !!file && (file.type?.startsWith('image/') || IMAGE_EXT_RE.test(file.name || ''))
}

const IMAGE_MIMES = { jpg: 'jpeg', jpeg: 'jpeg', png: 'png', webp: 'webp', gif: 'gif', bmp: 'bmp', heic: 'heic', heif: 'heif', avif: 'avif' }
const COMPRESS_THRESHOLD = 1.5 * 1024 * 1024

// 朋友圈与照相馆共用：相册 MIME 缺失时按扩展名补齐，大图在传输前压缩。
export async function normalizeImage(file) {
  if (!isImageFile(file)) throw new Error('请选择图片文件')
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reader.onabort = () => reject(new Error('图片读取失败，请重试'))
    reader.readAsDataURL(file)
  })
  const extension = file.name?.match(/\.([a-z]+)$/i)?.[1]?.toLowerCase()
  const mime = file.type?.startsWith('image/') ? file.type.toLowerCase().replace('image/jpg', 'image/jpeg')
    : IMAGE_MIMES[extension] ? `image/${IMAGE_MIMES[extension]}` : ''
  const source = mime ? String(dataUrl).replace(/^data:[^;]*;base64,/, `data:${mime};base64,`) : dataUrl
  if (file.size <= COMPRESS_THRESHOLD && /^image\/(png|jpeg|webp|gif|avif)$/.test(mime)) return source

  const img = await new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('图片无法读取，请转换为 JPG 或 PNG 后重试'))
    image.src = source
  })
  const scale = Math.min(1, 1600 / Math.max(img.naturalWidth || 1, img.naturalHeight || 1))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round((img.naturalWidth || 1) * scale))
  canvas.height = Math.max(1, Math.round((img.naturalHeight || 1) * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('图片处理失败，请重试')
  context.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.88)
}
