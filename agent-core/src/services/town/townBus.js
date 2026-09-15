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

// 当前地图作用域：小镇运行时在处理某张图时设置，事件里带上 mapId，
// 客户端只应用自己当前那张图的事件（多图并存时不会把 A 镇的气泡画到 B 镇）。
let mapScope = null;
export function setTownBusMapScope(mapId) { mapScope = mapId ?? null; }
const withMap = payload => ({ ...worldScope, ...(mapScope != null ? { mapId: mapScope } : {}), ...payload });

export function broadcastTownStateUpdated(payload) { broadcast('town_state_updated', withMap(payload)); }

export function broadcastTownMove({ charId, from, path, speed, startedAt, revision }) {
  broadcast('town_move', withMap({ charId, from, path, speed, startedAt, ...(revision != null ? { revision } : {}) }));
}

export function broadcastTownBubble({ charId, encounterId = null, text, ttl }) {
  broadcast('town_bubble', withMap({ charId, encounterId, text, ttl }));
}

export function broadcastTownEncounterStart(payload) {
  broadcast('town_encounter_start', withMap(payload));
}

export function broadcastTownEncounterEnd(payload) {
  broadcast('town_encounter_end', withMap(payload));
}

export function broadcastTownPing() {
  broadcast('town_ping', { serverTime: Date.now() });
}

export function broadcastTownInitProgress(payload) {
  broadcast('town_init_progress', payload);
}

export function broadcastTownMapUpdated(payload) {
  broadcast('town_map_updated', withMap(payload));
}

/** 玩家换图（出行）：玩家级事件，不带地图过滤，客户端以它为准 */
export function broadcastTownPlayerMapChanged(payload) {
  broadcast('town_player_map_changed', { ...worldScope, ...payload });
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
