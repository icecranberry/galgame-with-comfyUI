import { getDb } from '../../db/index.js';
import { createTownActorRegistry } from './townActorRegistry.js';
import { createEconomyService } from './economyService.js';
import { config } from '../../config.js';
import { broadcastTownStateUpdated } from './townBus.js';
import { createTownNpcFunctionService } from './townNpcFunctionService.js';
import { createItemTemplateService } from './itemTemplateService.js';
import { createTownNpcStockService } from './townNpcStockService.js';
import { ITEM_EFFECTS } from '../itemService.js';
import { createTownExperienceService, TOWN_EXPERIENCE_CONSUMER } from './townExperienceService.js';
import { applyMemoryActions } from '../memory/memoryRepository.js';
import { getMemorySettings } from '../memory/memoryConfig.js';

/** HTTP adapters resolve player ownership on the server, never from request JSON. */
export function getTownEconomyContext() {
  const db = getDb();
  const registry = createTownActorRegistry(db);
  const world = registry.getWorldState();
  const player = registry.resolveAgentKey('me');
  const scope = { worldId: world.worldId, worldEpoch: world.epoch };
  const economy = createEconomyService({ db, clock: { now: Date.now },
    getWorldEpoch: registry.getWorldEpoch, getActor: registry.getActor });
  return { db, registry, world, player, scope, economy };
}

/** 从 source_key 里挖出这条账目的上下文（哪位居民、哪件事），
 *  让钱袋列表能写出「请铃兰提供「量体裁衣」」而不是干巴巴的「付出一笔」。 */
function receiptContext(db, sourceKey) {
  const key = String(sourceKey || '');
  const service = /^town_npc_service:(\d+):/.exec(key);
  if (service) {
    const row = db.prepare(`SELECT s.kind, s.offer_title, n.display_name FROM town_npc_service_sessions s
      LEFT JOIN town_npcs n ON n.id = s.npc_id WHERE s.id = ?`).get(Number(service[1]));
    if (row) return { npcName: row.display_name || '', offerTitle: row.offer_title || '', kind: row.kind || '' };
  }
  const stock = /^npc-stock:(\d+):/.exec(key);
  if (stock) {
    const row = db.prepare(`SELECT s.custom_name, n.display_name FROM town_npc_stock s
      LEFT JOIN town_npcs n ON n.id = s.npc_id WHERE s.id = ?`).get(Number(stock[1]));
    if (row) return { npcName: row.display_name || '', itemName: row.custom_name || '' };
  }
  return {};
}

export function getTownWallet() {
  const { db, player, scope, economy } = getTownEconomyContext();
  const wallet = economy.ensureAccount({ ...scope, ownerKey: `actor:${player.actorId}`,
    accountType: 'actor', actorId: player.actorId });
  const receipts = db.prepare(`SELECT t.command, t.reason_code, t.source_key, t.occurred_at, e.amount
    FROM economy_transactions t
    JOIN economy_entries e ON e.transaction_id = t.transaction_id WHERE e.account_id = ?
    ORDER BY t.rowid DESC LIMIT 20`).all(wallet.accountId)
    .map(r => ({ command: r.command, reasonCode: r.reason_code, occurredAt: r.occurred_at, amount: r.amount,
      ...receiptContext(db, r.source_key) }));
  return { ...scope, actorId: player.actorId, currency: '邻币', balance: wallet.balance,
    reserved: wallet.reserved, available: wallet.available, version: wallet.version, receipts };
}

/** Shared context for the remaining town-life surfaces: wallet, NPC trade/gift and story interactions. */
export function getTownLifeRuntime() {
  const context = getTownEconomyContext();
  const { db, registry, economy } = context;
  const dependencies = { db, registry, economy, clock: { now: Date.now },
    getWorldEpoch: registry.getWorldEpoch, getActor: registry.getActor,
    consumers: [TOWN_EXPERIENCE_CONSUMER] };
  const itemTemplates = createItemTemplateService({ ...dependencies, effectRegistry: ITEM_EFFECTS });
  // NPC 功能点（送东西/做买卖）：钱包各自独立开户，成交由服务端注册表校验。
  const npcFunctions = createTownNpcFunctionService({ ...dependencies, itemTemplates });
  return { ...context, itemTemplates, npcFunctions };
}

function lifeScope(context, input) {
  if (!Number.isSafeInteger(input.worldEpoch) || input.worldEpoch !== context.scope.worldEpoch) {
    throw Object.assign(new Error('小镇已更新，请刷新后重试'), { status: 409, code: 'STALE_EPOCH' });
  }
  if (typeof input.idempotencyKey !== 'string' || !input.idempotencyKey.trim() || input.idempotencyKey.length > 128) {
    throw Object.assign(new Error('请求标识无效'), { status: 400 });
  }
  return { ...context.scope, idempotencyKey: input.idempotencyKey };
}

/** 小镇生活维护：把赠礼等已入账事件沉淀为角色共同经历与记忆。 */
export function maintainTownLife() {
  const context = getTownEconomyContext();
  createTownExperienceService({ db: context.db, clock: { now: Date.now }, registry: context.registry,
    writeMemory: applyMemoryActions, memoryEnabled: () => getMemorySettings().enabled,
    timeZone: config.town.timeZone || 'Asia/Shanghai' }).drain(context.scope);
}

/** NPC 功能档案查询：无声明时按规则现场分配并落库。 */
export function getTownNpcFunctions(npcId) {
  const context = getTownLifeRuntime();
  return context.npcFunctions.functionsOf(npcId, { ...context.scope, actorId: context.player.actorId });
}

export function receiveTownNpcGift(npcId, input) {
  const context = getTownLifeRuntime();
  const scope = lifeScope(context, input);
  const result = context.npcFunctions.receiveGift(npcId, scope);
  broadcastTownStateUpdated({ reason: 'npc_gift' });
  return result;
}


/** 货架运行时：真实 economy 装配，供交易面板读取 / 换货 / 购买。 */
export function getTownNpcStockRuntime() {
  const context = getTownLifeRuntime();
  const stock = createTownNpcStockService({ db: context.db, clock: { now: Date.now },
    registry: context.registry, economy: context.economy });
  return { ...context, stock };
}

/** 买下一件货品：扣邻币、进背包、随机提升好感度。 */
export function buyTownNpcStock(npcId, stockId, input) {
  const context = getTownNpcStockRuntime();
  const scope = lifeScope(context, input);
  const result = context.stock.buyStock(npcId, stockId, scope);
  broadcastTownStateUpdated({ reason: 'npc_stock_bought' });
  return result;
}
