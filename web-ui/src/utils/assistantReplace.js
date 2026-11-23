/**
 * 续写失败重出后的**整条替换**语义。
 *
 * 后端事件：`replace_last_assistant{ content, segments:[{content, emojiKeys, stickerUrls, images}], reason:'continuation', turn }`
 * 语义：把**刚显示的那轮** assistant 气泡整段换成新内容 —— 复用既有气泡（不追加）、
 * 末尾多出来的删掉（旧文本不残留），并且不丢表情包与图片。
 *
 * 抽成纯函数（只吃数组、只改传进来的这两个数组）便于单测，也避免把替换逻辑
 * 内联在那个巨大的流式 onEvent 闭包里。
 *
 * @returns {{messages:Array, bubbleIds:Array}} 原对象（就地改），方便链式核对
 */
/** url 数组 → 消息上的图片项（与既有 sticker_images / images 同形） */
function toImageList(urls) {
  return (Array.isArray(urls) ? urls : []).map(url => ({ url, base64: null }))
}

/** 没有传 uid 时的兜底 id：只用于本地渲染，不参与任何安全判断 */
let fallbackSeq = 0

export function applyAssistantReplace({ messages, bubbleIds, segments, uid, now } = {}) {
  const list = Array.isArray(messages) ? messages : []
  const ids = Array.isArray(bubbleIds) ? bubbleIds : []
  const segs = Array.isArray(segments) ? segments : []
  const stamp = now || new Date().toISOString()
  const makeId = typeof uid === 'function' ? uid : () => `seg-${++fallbackSeq}`

  for (let i = 0; i < segs.length; i += 1) {
    const seg = segs[i] && typeof segs[i] === 'object' ? segs[i] : {}
    const content = seg.content === undefined || seg.content === null ? '' : String(seg.content)
    let m = ids[i] ? list.find(x => x.id === ids[i]) : null
    if (!m) {
      const id = ids[i] || makeId()
      ids[i] = id
      m = { id, role: 'assistant', type: 'text', content, created_at: stamp }
      list.push(m)
    } else {
      m.content = content
    }
    // 图片：给了非空 urls 才换；没给 / 空数组 → 保持原样（不丢）
    if (Array.isArray(seg.images) && seg.images.length > 0) {
      m.images = toImageList(seg.images)
    }
    // 表情包：优先用后端下发的 stickerUrls；缺失时退回 emojiKeys 的兜底规则
    let stickerFromUrls = false
    if (Array.isArray(seg.stickerUrls) && seg.stickerUrls.length > 0) {
      m.sticker_images = toImageList(seg.stickerUrls)
      stickerFromUrls = true
    }
    if (!stickerFromUrls && Array.isArray(seg.emojiKeys)) {
      // emojiKeys 是 key 不是 url；空数组＝显式「这轮没表情」，非空则保留原表情
      if (seg.emojiKeys.length === 0) m.sticker_images = []
    }
  }

  // 末尾多出来的气泡删掉 —— 这一段就是「旧文本不残留」的保证
  for (let i = ids.length - 1; i >= segs.length; i -= 1) {
    const dead = ids[i]
    const at = list.findIndex(x => x.id === dead)
    if (at >= 0) list.splice(at, 1)
  }
  ids.length = segs.length
  return { messages: list, bubbleIds: ids }
}
