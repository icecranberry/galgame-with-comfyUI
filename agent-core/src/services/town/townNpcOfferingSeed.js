/**
 * 开镇后台上料：给居民补齐「服务 / 打工 / 商品」。
 *
 * 权限决定内容（与 townCapabilities 同一口径）：
 *   - service：居民出面服务玩家  生成 town_npc_offers(kind=service)
 *   - work：玩家出力帮居民干活  生成 town_npc_offers(kind=work)
 *   - trade：居民开店卖货  生成 town_npc_stock 货架
 *
 * 由 townInitService 在「确认开镇」的最后一步异步调起，静默执行、不阻塞开镇：
 *   - 串行逐人处理，避免并发轰炸 LLM；
 *   - 幂等：已有项目 / 货架直接跳过，重复确认开镇不会重复生成；
 *   - 单人失败只警告，不影响其他人，也不影响已经开好的小镇。
 */
import { getDb } from '../../db/index.js';
import { townCapabilities } from './townCapabilities.js';
import { listNpcOffers, generateNpcOffers } from './townNpcOfferService.js';
import { ensureNpcStock } from './townNpcStockService.js';

const OFFER_KINDS = ['service', 'work'];

function currentWorldId(db) {
  const row = db.prepare('SELECT world_id FROM town_world_state WHERE singleton = 1').get();
  return row?.world_id || 'default';
}

/**
 * 给一张图（或全库）里所有有权限的居民补齐经营内容。
 * @param {{ mapId?: number|null, worldId?: string|null, llm?: object }} options
 * @returns {Promise<{ npcs:number, offers:number, stock:number, skipped:number, failed:number }>}
 */
export async function seedTownNpcOfferings({ mapId = null, worldId = null, llm } = {}) {
  const db = getDb();
  const wid = worldId || currentWorldId(db);
  const npcs = mapId == null
    ? db.prepare('SELECT * FROM town_npcs ORDER BY id').all()
    : db.prepare('SELECT * FROM town_npcs WHERE map_id = ? ORDER BY id').all(mapId);

  const summary = { npcs: npcs.length, offers: 0, stock: 0, skipped: 0, failed: 0 };

  for (const npc of npcs) {
    const caps = townCapabilities(npc, ['service']);

    for (const kind of OFFER_KINDS) {
      if (!caps.includes(kind)) continue;
      if (listNpcOffers({ worldId: wid, npcId: npc.id, kind }).length) {
        summary.skipped += 1;
        continue;
      }
      try {
        await generateNpcOffers({ worldId: wid, npcId: npc.id, kind, llm });
        summary.offers += 1;
      } catch (err) {
        summary.failed += 1;
        console.warn(`[townSeed] ${kind} offers for npc #${npc.id} failed:`, err?.message || err);
      }
    }

    if (caps.includes('trade')) {
      try {
        await ensureNpcStock({ worldId: wid, npcId: npc.id, llm });
        summary.stock += 1;
      } catch (err) {
        summary.failed += 1;
        console.warn(`[townSeed] stock for npc #${npc.id} failed:`, err?.message || err);
      }
    }
  }

  return summary;
}