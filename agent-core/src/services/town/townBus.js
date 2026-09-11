/**
 * 小镇事件广播总线
 *
 * 复用统一 SSE 总线（/api/stream，前端单一连接），事件类型统一加 town_ 前缀：
 *   town_move            {charId, from, path, speed, startedAt}   → 客户端插值
 *   town_bubble          {charId, encounterId?, text, ttl}        → 气泡/状态短语
 *   town_encounter_start {id, a, b, locationId, gridX, gridY}
 *   town_encounter_end   {id, summary}
 *   town_ping            {serverTime}                             → 客户端对时
 *   town_init_progress   {status, stage, done, total, current}    → 初始化向导进度
 *   town_map_updated     {mapId, version}                         → 地图保存/开镇，其他端重载
 *   town_assets_updated  {asset|deleted}                          → 素材生成完成/失败/删除
 */
import { broadcast } from '../unifiedStreamBus.js';
let worldScope = {};
export function setTownBusScope({ worldId, epoch }) { worldScope = { worldId, worldEpoch: epoch }; }
export function broadcastTownStateUpdated(payload) { broadcast('town_state_updated', { ...worldScope, ...payload }); }

export function broadcastTownMove({ charId, from, path, speed, startedAt, revision }) {
  broadcast('town_move', { ...worldScope, charId, from, path, speed, startedAt, ...(revision != null ? { revision } : {}) });
}

export function broadcastTownBubble({ charId, encounterId = null, text, ttl }) {
  broadcast('town_bubble', { ...worldScope, charId, encounterId, text, ttl });
}

export function broadcastTownEncounterStart(payload) {
  broadcast('town_encounter_start', { ...worldScope, ...payload });
}

export function broadcastTownEncounterEnd(payload) {
  broadcast('town_encounter_end', { ...worldScope, ...payload });
}

export function broadcastTownPing() {
  broadcast('town_ping', { serverTime: Date.now() });
}

export function broadcastTownInitProgress(payload) {
  broadcast('town_init_progress', payload);
}

export function broadcastTownMapUpdated(payload) {
  broadcast('town_map_updated', { ...worldScope, ...payload });
}

// 进程内订阅：素材提交/删除除了推给前端，还要让小镇运行时重建内存里的立绘/小人引用
// （townService.refreshAgentVisuals）——素材每次提交都换新文件并删旧文件，内存引用不同步就会 404。
const assetUpdateListeners = new Set();
export function onTownAssetsUpdated(listener) {
  assetUpdateListeners.add(listener);
  return () => assetUpdateListeners.delete(listener);
}

export function broadcastTownAssetsUpdated(payload) {
  broadcast('town_assets_updated', { ...worldScope, ...payload });
  for (const listener of assetUpdateListeners) {
    try { listener(payload); } catch (err) { console.warn('[townBus] asset update listener failed:', err?.message || err); }
  }
}
