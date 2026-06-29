/**
 * 统一 SSE 总线
 *
 * 替代 3 个独立 SSE 端点各自维护客户端 Set 的架构：
 *   - /api/events/stream
 *   - /api/moments/stream
 *   - /api/notifications/stream
 *
 * 所有模块广播到同一组客户端，前端只需 1 个 HTTP 连接接收所有事件。
 * 释放 HTTP/1.1 6 连接限制下的 2 个连接位。
 */

const clients = new Set();

export function addClient(res) {
  clients.add(res);
}

export function removeClient(res) {
  clients.delete(res);
}

/**
 * @param {string} eventType - SSE event type (e.g. 'new_event', 'new_post', 'proactive_message')
 * @param {object} data - JSON-serializable payload
 */
export function broadcast(eventType, data) {
  let payload;
  try {
    payload = `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
  } catch (e) {
    console.error(`[unifiedSSE] broadcast failed — JSON.stringify error for ${eventType}:`, e.message);
    return;
  }
  for (const client of clients) {
    try {
      client.write(payload);
    } catch {
      clients.delete(client);
    }
  }
}

/** 活跃客户端数（调试用） */
export function clientCount() {
  return clients.size;
}
