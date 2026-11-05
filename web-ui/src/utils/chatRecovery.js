// 仅保存本机未确认完成的一轮；半截内容不写入模型上下文。
const key = id => `linshe:chat-recovery:${id}`
export function readChatRecovery(id) {
  try {
    const value = JSON.parse(globalThis.localStorage?.getItem(key(id)) || 'null')
    return value && typeof value.clientMsgId === 'string' && typeof value.content === 'string' ? value : null
  } catch { return null }
}
export function writeChatRecovery(id, value) {
  try {
    if (value) globalThis.localStorage?.setItem(key(id), JSON.stringify(value))
    else globalThis.localStorage?.removeItem(key(id))
  } catch { /* 存储被浏览器禁用时，当前页面仍保留已收到的回复。 */ }
}
