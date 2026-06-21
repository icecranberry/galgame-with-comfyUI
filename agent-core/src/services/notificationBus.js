/**
 * 通知总线 — 跨模块 SSE 广播轻量通道
 *
 * proactiveChatScheduler 写入主动消息后通过此模块广播给 notifications 路由的 SSE 客户端。
 * 独立于 express/Router，避免 services ↔ routes 循环依赖。
 */

const sseClients = new Set();

/**
 * 向所有连接的 SSE 客户端广播主动消息事件
 * @param {object} data - { character_id, display_name, avatar_path, content, msg_id, created_at }
 */
export function broadcastProactiveMessage(data) {
  const payload = `event: proactive_message\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try { client.write(payload); } catch { sseClients.delete(client); }
  }
}

/**
 * 注册 SSE 客户端（由 notifications 路由调用）
 * @param {import('http').ServerResponse} res
 */
export function addSSEClient(res) {
  sseClients.add(res);
}

/**
 * 移除 SSE 客户端
 * @param {import('http').ServerResponse} res
 */
export function removeSSEClient(res) {
  sseClients.delete(res);
}
