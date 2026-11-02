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
