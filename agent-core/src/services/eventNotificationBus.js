/**
 * 奇遇事件 SSE 通知总线
 *
 * 独立于 EventEmitter/Express Router 的轻量 SSE 广播通道
 * 参考 notificationBus.js 模式
 */

import { broadcast as broadcastToUnified } from './unifiedStreamBus.js';

const sseClients = new Set();

export function addSSEClient(res) {
  sseClients.add(res);
}

export function removeSSEClient(res) {
  sseClients.delete(res);
}

export function broadcastNewEvent(data) {
  _broadcast('new_event', data);
  broadcastToUnified('new_event', data);
}

export function broadcastEventUpdate(data) {
  _broadcast('event_update', data);
  broadcastToUnified('event_update', data);
}

export function broadcastEventConclusion(data) {
  _broadcast('event_concluded', data);
  broadcastToUnified('event_concluded', data);
}

export function broadcastEventExpired(data) {
  _broadcast('event_expired', data);
  broadcastToUnified('event_expired', data);
}

export function broadcastEventUrgency(data) {
  _broadcast('event_urgency', data);
  broadcastToUnified('event_urgency', data);
}

function _broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch {
      sseClients.delete(client);
    }
  }
}
