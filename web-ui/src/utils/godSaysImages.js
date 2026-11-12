// 图片只来自已成功的生图工具结果，不执行模型正文里的任意图片 URL。
const imageTools = new Set(['generate_image', 'generate_studio_photo', 'read_studio_photo'])
export const isGodImageTool = name => imageTools.has(name)

export function godMessageImages(turn, message) {
  const ids = new Set((message.tool_calls || []).filter(call => isGodImageTool(call.function?.name)).map(call => call.id))
  const seen = new Set()
  return (turn.calls || []).filter(call => isGodImageTool(call.name) && call.status === 'done' && call.result?.ok
    && [...ids].some(id => call.id.endsWith(`:${id}`))).flatMap(call => {
    const data = call.result.value?.data
    if (data?.success !== true || !Array.isArray(data.images)) return []
    const allowedUrl = call.name === 'generate_image'
      ? /^\/images\/chat\/[a-zA-Z0-9_-]+\.(png|jpe?g|webp)$/
      : /^\/images\/photo_studio\/[a-zA-Z0-9_-]+\.(png|jpe?g|webp|avif)$/
    return data.images.filter(image => typeof image.url === 'string' && allowedUrl.test(image.url))
      .filter(image => { if (seen.has(image.url)) return false; seen.add(image.url); return true })
      .map(image => ({ url: image.url, width: image.width || data.width, height: image.height || data.height }))
  })
}
