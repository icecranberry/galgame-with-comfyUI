/**
 * 小镇事件广播总线
 *
 * 复用统一 SSE 总线（/api/stream，前端单一连接），事件类型统一加 town_ 前缀：
 *   town_move            {charId, from, path, speed, startedAt}   → 客户端插值
 *   town_bubble          {charId, encounterId?, text, ttl}        → 气泡/状态短语
 *   town_encounter_start {id, a, b, locationId, gridX, gridY}
 *   town_encounter_end   {id, summary}
 *   town_ping            {serverTime}                             → 客户端对时
 */
import { broadcast } from '../unifiedStreamBus.js';

export function broadcastTownMove({ charId, from, path, speed, startedAt }) {
  broadcast('town_move', { charId, from, path, speed, startedAt });
}

export function broadcastTownBubble({ charId, encounterId = null, text, ttl }) {
  broadcast('town_bubble', { charId, encounterId, text, ttl });
}

export function broadcastTownEncounterStart(payload) {
  broadcast('town_encounter_start', payload);
}

export function broadcastTownEncounterEnd(payload) {
  broadcast('town_encounter_end', payload);
}

export function broadcastTownPing() {
  broadcast('town_ping', { serverTime: Date.now() });
}
